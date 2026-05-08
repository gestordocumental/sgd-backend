import {
  Injectable,
  InternalServerErrorException,
  GatewayTimeoutException,
  BadRequestException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { AppLogger } from '../logger/app-logger.service';
import { getCorrelationId } from '../correlation/correlation.context';
import { CORRELATION_ID_HEADER } from '../middleware/correlation.middleware';

export interface TypologyPublicInfo {
  id: string;
  nombre: string;
  codigo: string;
  version: string;
  estructuraOrg: {
    departamentoId: string;
    departamentoNombre: string;
    areaId: string | null;
    areaNombre: string | null;
    cargoId: string | null;
    cargoNombre: string | null;
  };
}

export interface DocumentDiscrepancy {
  field: string;
  expected: string;
  extracted: string;
}

export interface ValidateDocumentResult {
  isValid: boolean;
  typology: {
    nombre: string;
    codigo: string;
    version: string;
  };
  document: {
    extractedTitle: string | null;
    extractedCode: string | null;
    extractedVersion: string | null;
    storageKey: string;
    originalName: string;
    mimeType: string;
    fileSizeBytes: number | null;
  };
  discrepancies: DocumentDiscrepancy[];
}

@Injectable()
export class DocumentClientService {
  private readonly documentServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.documentServiceUrl = this.config.getOrThrow<string>('DOCUMENT_SERVICE_URL');
    this.internalToken      = this.config.getOrThrow<string>('INTERNAL_TOKEN');
    const raw               = this.config.get<string | number>('DOCUMENT_SERVICE_TIMEOUT_MS');
    const parsed            = raw == null ? 5_000 : Number(raw);
    this.timeoutMs          = Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000;
  }

  /**
   * Obtiene información pública de una tipología desde document-service.
   * Usado al crear el workflow para denormalizar nombre/código/versión.
   *
   * Endpoint requerido en document-service:
   *   GET /internal/typologies/:id/public-info
   */
  async getTypologyInfo(typologyId: string): Promise<TypologyPublicInfo> {
    const correlationId = getCorrelationId();
    const url = `${this.documentServiceUrl}/internal/typologies/${typologyId}/public-info`;

    this.logger.http({
      type: 'internal-request',
      target: 'document-service',
      url,
      correlationId,
      message: `→ [document-service] GET /internal/typologies/${typologyId}/public-info`,
    });

    try {
      const response = await firstValueFrom(
        this.httpService
          .get<TypologyPublicInfo>(url, {
            headers: {
              'x-internal-token':      this.internalToken,
              [CORRELATION_ID_HEADER]: correlationId,
            },
          })
          .pipe(timeout(this.timeoutMs)),
      );

      this.logger.http({
        type: 'internal-response',
        target: 'document-service',
        statusCode: 200,
        correlationId,
        message: `← [document-service] GET /internal/typologies/${typologyId}/public-info 200`,
      });

      return response.data;
    } catch (error: unknown) {
      return this.handleError(error, 'document-service', url, correlationId);
    }
  }

  /**
   * Valida que el documento cargado coincida con la tipología seleccionada.
   * Compara título, código y versión extraídos contra los declarados en la tipología.
   *
   * Endpoint requerido en document-service:
   *   POST /internal/documents/validate-for-workflow
   *   Body: { typologyId: string, documentId: string }
   */
  async validateDocument(
    typologyId: string,
    documentId: string,
  ): Promise<ValidateDocumentResult> {
    const correlationId = getCorrelationId();
    const url = `${this.documentServiceUrl}/internal/documents/validate-for-workflow`;

    this.logger.http({
      type: 'internal-request',
      target: 'document-service',
      url,
      correlationId,
      message: `→ [document-service] POST /internal/documents/validate-for-workflow`,
    });

    try {
      const response = await firstValueFrom(
        this.httpService
          .post<ValidateDocumentResult>(
            url,
            { typologyId, documentId },
            {
              headers: {
                'x-internal-token':      this.internalToken,
                [CORRELATION_ID_HEADER]: correlationId,
              },
            },
          )
          .pipe(timeout(this.timeoutMs)),
      );

      this.logger.http({
        type: 'internal-response',
        target: 'document-service',
        statusCode: 200,
        correlationId,
        message: `← [document-service] POST /internal/documents/validate-for-workflow 200`,
      });

      return response.data;
    } catch (error: unknown) {
      return this.handleError(error, 'document-service', url, correlationId);
    }
  }

  private handleError(
    error: unknown,
    target: string,
    url: string,
    correlationId: string,
  ): never {
    if (error instanceof TimeoutError) {
      this.logger.http({
        type: 'internal-response',
        target,
        statusCode: 504,
        correlationId,
        message: `← [${target}] ${url} 504: timed out after ${this.timeoutMs}ms`,
      });
      throw new GatewayTimeoutException(`${target} did not respond in time`);
    }

    const err     = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status  = err?.response?.status;
    const message = err?.response?.data?.message ?? err?.message ?? 'Unknown error';

    this.logger.http({
      type: 'internal-response',
      target,
      statusCode: status ?? 500,
      correlationId,
      message: `← [${target}] ${url} ${status ?? 500}: ${message}`,
    });

    if (status === 400) throw new BadRequestException(message);
    if (status === 404) throw new BadRequestException(`Resource not found in ${target}: ${message}`);

    throw new InternalServerErrorException(`Error communicating with ${target}: ${message}`);
  }
}

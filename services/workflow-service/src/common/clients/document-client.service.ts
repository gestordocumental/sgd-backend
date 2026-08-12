import {
  Injectable,
  InternalServerErrorException,
  GatewayTimeoutException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { AppLogger, getCorrelationId, CORRELATION_ID_HEADER } from '@sgd/common';
import CircuitBreaker = require('opossum');

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
  reviewCycleEnabled: boolean;
}

export interface ReviewCycleEnabledResult {
  id: string;
  reviewCycleEnabled: boolean;
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
  private readonly cb: CircuitBreaker;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.documentServiceUrl = this.config.getOrThrow<string>('DOCUMENT_SERVICE_URL');
    this.internalToken      = this.config.getOrThrow<string>('INTERNAL_TOKEN_WORKFLOW_DOC');
    const raw               = this.config.get<string | number>('DOCUMENT_SERVICE_TIMEOUT_MS');
    const parsed            = raw == null ? 5_000 : Number(raw);
    this.timeoutMs          = Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000;

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'document-service',
        timeout:                  false,   // RxJS timeout() handles per-request timeouts
        errorThresholdPercentage: 75,
        resetTimeout:             10_000,
        volumeThreshold:          10,
      },
    );
    this.cb.on('open',     () => this.logger.warn('[circuit] document-service OPEN — failing fast', 'DocumentClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] document-service HALF-OPEN — probing', 'DocumentClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] document-service CLOSED — recovered', 'DocumentClientService'));
  }

  /**
   * Obtiene información pública de una tipología desde document-service.
   * Usado al crear el workflow para denormalizar nombre/código/versión.
   *
   * Endpoint requerido en document-service:
   *   GET /internal/typologies/:id/public-info
   */
  async getTypologyInfo(orgId: string, typologyId: string): Promise<TypologyPublicInfo> {
    const correlationId = getCorrelationId();
    const url = `${this.documentServiceUrl}/internal/typologies/${typologyId}/public-info?orgId=${encodeURIComponent(orgId)}`;

    this.logger.http({
      type: 'internal-request',
      target: 'document-service',
      url,
      correlationId,
      message: `→ [document-service] GET /internal/typologies/${typologyId}/public-info`,
    });

    try {
      const response = await this.fireWithCb<{ data: TypologyPublicInfo }>(() =>
        firstValueFrom(
          this.httpService
            .get<TypologyPublicInfo>(url, {
              headers: {
                'x-internal-token':      this.internalToken,
                [CORRELATION_ID_HEADER]: correlationId,
              },
            })
            .pipe(timeout(this.timeoutMs)),
        ),
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
      if (error instanceof ServiceUnavailableException) throw error;
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
      const response = await this.fireWithCb<{ data: ValidateDocumentResult }>(() =>
        firstValueFrom(
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
        ),
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
      if (error instanceof ServiceUnavailableException) throw error;
      return this.handleError(error, 'document-service', url, correlationId);
    }
  }

  /**
   * Whether workflows created against this typology should go through the
   * admin review cycle step. Called only once per workflow, from approve()'s
   * final-approval branch, to decide the reviewCycleEnabled snapshot stored
   * on that workflow at the moment it leaves the approval flow — that
   * snapshot then travels with the workflow for its whole lifetime and is
   * never re-checked live again (see MGESTDOC-58: changes to this flag must
   * only affect workflows created afterwards, not ones already past
   * approval).
   *
   * `false` is only ever a genuine, validated answer from document-service —
   * never a stand-in for "couldn't tell". The caller treats `false` as
   * authoritative and acts on it immediately (skips the review cycle), so
   * silently defaulting to `false` on a document-service outage would
   * silently skip a review cycle that was actually enabled. Propagate
   * failures instead — the caller surfaces a 503/500 and the client can
   * retry once document-service is back, same as every other method on this
   * class.
   *
   * `timeoutMs`/`useCircuitBreaker` exist for callers that want to opt out of
   * the shared defaults (e.g. a best-effort/display-only read that shouldn't
   * wait the full timeout or poison the breaker shared with
   * getTypologyInfo()/validateDocument()) — the current caller doesn't need
   * that and uses the defaults.
   *
   * Endpoint requerido en document-service:
   *   GET /internal/typologies/:id/review-cycle-enabled?orgId=:orgId
   */
  async isReviewCycleEnabledForTypology(
    orgId: string,
    typologyId: string,
    timeoutMs: number = this.timeoutMs,
    useCircuitBreaker: boolean = true,
  ): Promise<boolean> {
    const correlationId = getCorrelationId();
    const url = `${this.documentServiceUrl}/internal/typologies/${typologyId}/review-cycle-enabled?orgId=${encodeURIComponent(orgId)}`;

    // Validation lives inside this closure (not after it resolves) so a
    // malformed 200 counts as a failure for the circuit breaker too, when the
    // breaker is in play — otherwise document-service could return garbage on
    // every call and the breaker would never see it as unhealthy.
    const fetchAndValidate = async (): Promise<boolean> => {
      const response = await firstValueFrom(
        this.httpService
          .get<ReviewCycleEnabledResult>(url, {
            headers: {
              'x-internal-token':      this.internalToken,
              [CORRELATION_ID_HEADER]: correlationId,
            },
          })
          .pipe(timeout(timeoutMs)),
      );
      const reviewCycleEnabled = response.data?.reviewCycleEnabled;
      if (typeof reviewCycleEnabled !== 'boolean') {
        throw new Error('Invalid reviewCycleEnabled response from document-service');
      }
      return reviewCycleEnabled;
    };

    try {
      return await (useCircuitBreaker ? this.fireWithCb(fetchAndValidate) : fetchAndValidate());
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      return this.handleError(error, 'document-service', url, correlationId, timeoutMs);
    }
  }

  private async fireWithCb<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.cb.fire(fn) as T;
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER') {
        throw new ServiceUnavailableException('document-service is temporarily unavailable');
      }
      throw err;
    }
  }

  private handleError(
    error: unknown,
    target: string,
    url: string,
    correlationId: string,
    timeoutMs: number = this.timeoutMs,
  ): never {
    if (error instanceof TimeoutError) {
      this.logger.http({
        type: 'internal-response',
        target,
        statusCode: 504,
        correlationId,
        message: `← [${target}] ${url} 504: timed out after ${timeoutMs}ms`,
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
    if (status === 404) throw new NotFoundException('Resource not found');

    throw new InternalServerErrorException('An unexpected error occurred — please try again');
  }
}

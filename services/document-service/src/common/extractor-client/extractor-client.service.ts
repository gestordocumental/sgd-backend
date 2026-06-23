import {
  Injectable,
  BadRequestException,
  UnprocessableEntityException,
  InternalServerErrorException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import * as FormData from 'form-data';
import { AppLogger, CORRELATION_ID_HEADER } from '@sgd/common';
import { getCorrelationId } from '@sgd/common';
import CircuitBreaker = require('opossum');

export interface PreviewExtractResult {
  nombre: string | null;
  codigo: string | null;
  version: string | null;
}

@Injectable()
export class ExtractorClientService {
  private readonly extractorUrl: string;
  private readonly timeoutMs: number;
  private readonly cb: CircuitBreaker;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.extractorUrl = this.config.getOrThrow<string>('METADATA_EXTRACTOR_URL');
    const rawTimeout   = this.config.get<string | number>('METADATA_EXTRACTOR_TIMEOUT_MS');
    const parsedTimeout = rawTimeout == null ? 15_000 : Number(rawTimeout);
    this.timeoutMs      = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 15_000;

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'metadata-extractor-service',
        timeout:                  false,   // RxJS timeout() handles per-request timeouts
        errorThresholdPercentage: 50,
        resetTimeout:             30_000,
        volumeThreshold:          3,
        errorFilter: (err: any) => {
          const s = err?.response?.status;
          // 400 Bad Request and 422 Unprocessable Entity are caller errors,
          // not extractor failures — exclude them from circuit-breaker metrics.
          // All other codes (401, 404, 429, 5xx, network errors) count as failures.
          return s === 400 || s === 422;
        },
      },
    );
    this.cb.on('open',     () => this.logger.warn('[circuit] metadata-extractor-service OPEN — failing fast', 'ExtractorClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] metadata-extractor-service HALF-OPEN — probing',  'ExtractorClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] metadata-extractor-service CLOSED — recovered',   'ExtractorClientService'));
  }

  async previewExtract(file: Express.Multer.File, orgName?: string): Promise<PreviewExtractResult> {
    const correlationId = getCorrelationId();
    const url = `${this.extractorUrl}/preview/extract`;

    this.logger.http({
      type: 'internal-request',
      target: 'metadata-extractor-service',
      url,
      correlationId,
      message: `→ [metadata-extractor] POST /preview/extract (${file.originalname})`,
    });

    const form = new FormData();
    form.append('file', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    if (orgName) form.append('orgName', orgName);

    try {
      const response = await this.fireWithCb<{ data: PreviewExtractResult }>(() =>
        firstValueFrom(
          this.httpService.post<PreviewExtractResult>(url, form, {
            headers: {
              ...form.getHeaders(),
              [CORRELATION_ID_HEADER]: correlationId,
            },
          }).pipe(timeout(this.timeoutMs)),
        ),
      );

      this.logger.http({
        type: 'internal-response',
        target: 'metadata-extractor-service',
        statusCode: 200,
        correlationId,
        message: `← [metadata-extractor] POST /preview/extract 200`,
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof ServiceUnavailableException) throw error;

      if (error instanceof TimeoutError) {
        this.logger.http({
          type: 'internal-response',
          target: 'metadata-extractor-service',
          statusCode: 504,
          correlationId,
          message: `← [metadata-extractor] POST /preview/extract 504: timed out after ${this.timeoutMs}ms`,
        });
        throw new GatewayTimeoutException('metadata-extractor-service did not respond in time');
      }

      const status  = error?.response?.status;
      const message = error?.response?.data?.message ?? error?.message ?? 'Unknown error';

      this.logger.http({
        type: 'internal-response',
        target: 'metadata-extractor-service',
        statusCode: status ?? 500,
        correlationId,
        message: `← [metadata-extractor] POST /preview/extract ${status ?? 500}: ${message}`,
      });

      // Propagate 4xx from the extractor as meaningful client errors instead of 500.
      if (status === 400) throw new BadRequestException(message);
      if (status === 422) throw new UnprocessableEntityException(message);

      throw new InternalServerErrorException(
        `Could not extract metadata from metadata-extractor-service: ${message}`,
      );
    }
  }

  private async fireWithCb<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.cb.fire(fn) as T;
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER') {
        throw new ServiceUnavailableException('metadata-extractor-service is temporarily unavailable');
      }
      throw err;
    }
  }
}

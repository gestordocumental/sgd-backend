import { Injectable, InternalServerErrorException, GatewayTimeoutException, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { AppLogger, CORRELATION_ID_HEADER, getCorrelationId, isNonTrippingClientError } from '@sgd/common';
import CircuitBreaker = require('opossum');

// Re-exported for this file's existing spec import — the actual definition
// (and its circuit-breaker-policy reasoning) now lives in @sgd/common,
// shared with every other internal HTTP client instead of forked per file.
export { isNonTrippingClientError };

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
    this.internalToken      = this.config.getOrThrow<string>('INTERNAL_TOKEN_ORG_DOC');
    const rawTimeout    = this.config.get<string | number>('DOCUMENT_SERVICE_TIMEOUT_MS');
    const parsedTimeout = rawTimeout == null ? 5_000 : Number(rawTimeout);
    this.timeoutMs      = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 5_000;

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'document-service',
        timeout:                  false,   // RxJS timeout() handles per-request timeouts
        errorThresholdPercentage: 50,
        resetTimeout:             30_000,
        volumeThreshold:          3,
        errorFilter:              (err: { response?: { status?: number } }) =>
          isNonTrippingClientError(err?.response?.status),
      },
    );
    this.cb.on('open',     () => this.logger.warn('[circuit] document-service OPEN — failing fast', 'DocumentClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] document-service HALF-OPEN — probing',  'DocumentClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] document-service CLOSED — recovered',   'DocumentClientService'));
  }

  /**
   * Counts non-deleted typologies whose estructuraOrg references the given
   * departamento/area/cargo — used to block deleting a position in org-service
   * that a typology still points to (see CargosService/AreasService/
   * DepartamentosService.remove()). Exactly one of the filter fields must be
   * set — this mirrors the id being deleted at the caller's level.
   */
  async countOrgStructureReferences(
    orgId: string,
    filters: { departamentoId?: string; areaId?: string; cargoId?: string },
  ): Promise<number> {
    const correlationId = getCorrelationId();
    const params = new URLSearchParams({ orgId });
    if (filters.departamentoId) params.set('departamentoId', filters.departamentoId);
    if (filters.areaId)         params.set('areaId', filters.areaId);
    if (filters.cargoId)        params.set('cargoId', filters.cargoId);
    const url = `${this.documentServiceUrl}/internal/typologies/org-structure-references?${params.toString()}`;

    this.logger.http({
      type: 'internal-request', target: 'document-service', url, correlationId,
      message: `→ [document-service] GET /internal/typologies/org-structure-references`,
    });

    try {
      const response = await this.fireWithCb(() =>
        firstValueFrom(
          this.httpService.get<{ count: number }>(url, {
            headers: { 'x-internal-token': this.internalToken, [CORRELATION_ID_HEADER]: correlationId },
          }).pipe(timeout(this.timeoutMs)),
        ),
      );

      this.logger.http({
        type: 'internal-response', target: 'document-service', statusCode: 200, correlationId,
        message: `← [document-service] GET /internal/typologies/org-structure-references 200`,
      });

      // A 200 with a body missing/malformed `count` (a proxy swallowing it, a
      // stale document-service build, a differently-shaped error wrapped as
      // 200) must not silently become `undefined` here — every caller does
      // `count > 0`, and `undefined > 0` is false, so a malformed response
      // would let a delete through as if zero references existed. Fail
      // closed instead of trusting the type annotation on .get<{count}>(),
      // which only affects TypeScript, not what's actually on the wire.
      if (typeof response.data?.count !== 'number' || !Number.isFinite(response.data.count)) {
        throw new InternalServerErrorException(
          'document-service returned a malformed org-structure-references response (missing or non-numeric count)',
        );
      }

      return response.data.count;
    } catch (error: any) {
      if (error instanceof InternalServerErrorException) throw error;
      if (error instanceof ServiceUnavailableException) throw error;

      if (error instanceof TimeoutError) {
        this.logger.http({
          type: 'internal-response', target: 'document-service', statusCode: 504, correlationId,
          message: `← [document-service] GET /internal/typologies/org-structure-references 504: timed out after ${this.timeoutMs}ms`,
        });
        throw new GatewayTimeoutException('document-service did not respond in time');
      }

      const status  = error?.response?.status;
      const message = error?.response?.data?.message ?? error?.message ?? 'Unknown error';

      this.logger.http({
        type: 'internal-response', target: 'document-service', statusCode: status ?? 500, correlationId,
        message: `← [document-service] GET /internal/typologies/org-structure-references ${status ?? 500}: ${message}`,
      });

      if (typeof status === 'number' && status >= 400 && status < 500) {
        throw new HttpException(message, status);
      }
      throw new InternalServerErrorException(
        `Could not check typology references from document-service: ${message}`,
      );
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
}

import { Injectable, InternalServerErrorException, GatewayTimeoutException, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { AppLogger, CORRELATION_ID_HEADER, getCorrelationId } from '@sgd/common';
import CircuitBreaker = require('opossum');

/**
 * True for 4xx statuses that are deterministic client/business errors (not found,
 * forbidden, validation) — repeating the exact same request wouldn't succeed, so
 * they must not count as a circuit failure. 408 (timeout) and 429 (rate limited)
 * are deliberately excluded: they signal document-service is struggling, not a
 * bad request, so they must trip the circuit the same way a 5xx would.
 */
export function isNonTrippingClientError(status: unknown): boolean {
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
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

      return response.data.count;
    } catch (error: any) {
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

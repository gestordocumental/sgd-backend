import { Injectable, InternalServerErrorException, GatewayTimeoutException, ServiceUnavailableException, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { AppLogger, CORRELATION_ID_HEADER } from '@sgd/common';
import { getCorrelationId } from '@sgd/common';
import CircuitBreaker = require('opossum');

export interface ResolveStructureItem {
  department: string;
  area?: string;
  position?: string;
}

export interface ResolvedItem {
  index: number;
  departamentoId: string;
  areaId: string | null;
  cargoId: string | null;
}

export interface UnresolvedItem {
  index: number;
  reason: string;
}

export interface ResolveStructureResult {
  resolved: ResolvedItem[];
  unresolved: UnresolvedItem[];
}

export interface ResolveByIdResult {
  departamentoId: string;
  departamentoNombre: string;
  areaId: string | null;
  areaNombre: string | null;
  cargoId: string | null;
  cargoNombre: string | null;
}

@Injectable()
export class OrgClientService {
  private readonly orgServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs: number;
  private readonly cb: CircuitBreaker;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.orgServiceUrl = this.config.getOrThrow<string>('ORG_SERVICE_URL');
    this.internalToken = this.config.getOrThrow<string>('INTERNAL_TOKEN_DOC_ORG');
    const rawTimeout    = this.config.get<string | number>('ORG_SERVICE_TIMEOUT_MS');
    const parsedTimeout = rawTimeout == null ? 5_000 : Number(rawTimeout);
    this.timeoutMs      = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 5_000;

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'org-service',
        timeout:                  false,   // RxJS timeout() handles per-request timeouts
        errorThresholdPercentage: 50,
        resetTimeout:             30_000,
        volumeThreshold:          3,
        errorFilter:              (err: any) => {
          const status = err?.response?.status;
          // 4xx are business-logic errors, not infrastructure failures — don't trip the circuit
          return status != null && status >= 400 && status < 500;
        },
      },
    );
    this.cb.on('open',     () => this.logger.warn('[circuit] org-service OPEN — failing fast', 'OrgClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] org-service HALF-OPEN — probing',  'OrgClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] org-service CLOSED — recovered',   'OrgClientService'));
  }

  async resolveStructure(
    orgId: string,
    items: ResolveStructureItem[],
  ): Promise<ResolveStructureResult> {
    const correlationId = getCorrelationId();
    const url = `${this.orgServiceUrl}/internal/structure/resolve`;

    this.logger.http({
      type: 'internal-request', target: 'org-service', url, correlationId,
      message: `→ [org-service] POST /internal/structure/resolve (${items.length} items)`,
    });

    try {
      const response = await this.fireWithCb(() =>
        firstValueFrom(
          this.httpService.post<ResolveStructureResult>(
            url,
            { orgId, items },
            { headers: { 'x-internal-token': this.internalToken, [CORRELATION_ID_HEADER]: correlationId } },
          ).pipe(timeout(this.timeoutMs)),
        ),
      );

      this.logger.http({
        type: 'internal-response', target: 'org-service', statusCode: 200, correlationId,
        message: `← [org-service] POST /internal/structure/resolve 200`,
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof ServiceUnavailableException) throw error;

      if (error instanceof TimeoutError) {
        this.logger.http({
          type: 'internal-response', target: 'org-service', statusCode: 504, correlationId,
          message: `← [org-service] POST /internal/structure/resolve 504: timed out after ${this.timeoutMs}ms`,
        });
        throw new GatewayTimeoutException('org-service did not respond in time');
      }

      const status  = error?.response?.status;
      const message = error?.response?.data?.message ?? error?.message ?? 'Unknown error';

      this.logger.http({
        type: 'internal-response', target: 'org-service', statusCode: status ?? 500, correlationId,
        message: `← [org-service] POST /internal/structure/resolve ${status ?? 500}: ${message}`,
      });

      throw new InternalServerErrorException(
        `Could not resolve org structure from org-service: ${message}`,
      );
    }
  }

  async resolveStructureById(
    orgId: string,
    departamentoId: string,
    areaId?: string,
    cargoId?: string,
  ): Promise<ResolveByIdResult> {
    const correlationId = getCorrelationId();
    const url = `${this.orgServiceUrl}/internal/structure/resolve-by-ids`;

    this.logger.http({
      type: 'internal-request', target: 'org-service', url, correlationId,
      message: `→ [org-service] POST /internal/structure/resolve-by-ids`,
    });

    try {
      const response = await this.fireWithCb(() =>
        firstValueFrom(
          this.httpService.post<ResolveByIdResult>(
            url,
            { orgId, departamentoId, areaId, cargoId },
            { headers: { 'x-internal-token': this.internalToken, [CORRELATION_ID_HEADER]: correlationId } },
          ).pipe(timeout(this.timeoutMs)),
        ),
      );

      this.logger.http({
        type: 'internal-response', target: 'org-service', statusCode: 200, correlationId,
        message: `← [org-service] POST /internal/structure/resolve-by-ids 200`,
      });

      return response.data;
    } catch (error: any) {
      if (error instanceof ServiceUnavailableException) throw error;

      if (error instanceof TimeoutError) {
        this.logger.http({
          type: 'internal-response', target: 'org-service', statusCode: 504, correlationId,
          message: `← [org-service] POST /internal/structure/resolve-by-ids 504: timed out after ${this.timeoutMs}ms`,
        });
        throw new GatewayTimeoutException('org-service did not respond in time');
      }

      const status  = error?.response?.status;
      const message = error?.response?.data?.message ?? error?.message ?? 'Unknown error';

      this.logger.http({
        type: 'internal-response', target: 'org-service', statusCode: status ?? 500, correlationId,
        message: `← [org-service] POST /internal/structure/resolve-by-ids ${status ?? 500}: ${message}`,
      });

      if (typeof status === 'number' && status >= 400 && status < 500) {
        throw new HttpException(message, status);
      }
      throw new InternalServerErrorException(
        `Could not resolve org structure by IDs from org-service: ${message}`,
      );
    }
  }

  private async fireWithCb<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.cb.fire(fn) as T;
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER') {
        throw new ServiceUnavailableException('org-service is temporarily unavailable');
      }
      throw err;
    }
  }
}

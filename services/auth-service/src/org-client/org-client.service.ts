import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom, timeout, TimeoutError } from "rxjs";
import { AppLogger, getCorrelationId, CORRELATION_ID_HEADER } from '@sgd/common';
import CircuitBreaker = require('opossum');

/**
 * True for 4xx statuses that are deterministic client/business errors (not found,
 * forbidden, validation) — repeating the exact same request wouldn't succeed, so
 * they must not count as a circuit failure. 408 (timeout) and 429 (rate limited)
 * are deliberately excluded: they signal org-service is struggling, not a bad
 * request, so they must trip the circuit the same way a 5xx would.
 */
export function isNonTrippingClientError(status: unknown): boolean {
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

@Injectable()
export class OrgClientService {
  private readonly orgServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs = 5_000;
  private readonly cb: CircuitBreaker;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.orgServiceUrl = this.configService.getOrThrow<string>("ORG_SERVICE_URL");
    this.internalToken = this.configService.getOrThrow<string>("INTERNAL_TOKEN_AUTH_ORG");

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'org-service',
        timeout:                  false,   // RxJS timeout() handles per-request timeouts
        errorThresholdPercentage: 75,
        resetTimeout:             10_000,
        volumeThreshold:          10,
        errorFilter: (err: { response?: { status?: number } }) =>
          isNonTrippingClientError(err?.response?.status),
      },
    );

    this.cb.on('open',     () => this.logger.warn('[circuit] org-service OPEN — failing fast', 'OrgClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] org-service HALF-OPEN — probing',  'OrgClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] org-service CLOSED — recovered',   'OrgClientService'));
  }

  /**
   * Returns the org's current status. Used by switchCompany to reject entering
   * the context of a company that has been deactivated — the target org must
   * still be reachable and active, not just something the user once belonged to.
   */
  async getOrgStatus(orgId: string): Promise<{ status: string }> {
    const correlationId = getCorrelationId();
    const url = `${this.orgServiceUrl}/internal/orgs/${orgId}/status`;

    this.logger.http({
      type: "internal-request",
      target: "org-service",
      url,
      correlationId,
      message: `→ [org-service] GET /internal/orgs/${orgId}/status`,
    });

    try {
      const response = await this.fireWithCb<{ data: { id: string; status: string } }>(() =>
        firstValueFrom(
          this.httpService
            .get<{ id: string; status: string }>(url, {
              headers: {
                "x-internal-token": this.internalToken,
                [CORRELATION_ID_HEADER]: correlationId,
              },
            })
            .pipe(timeout(this.timeoutMs)),
        ),
      );

      this.logger.http({
        type: "internal-response",
        target: "org-service",
        statusCode: 200,
        correlationId,
        message: `← [org-service] GET /internal/orgs/${orgId}/status 200`,
      });

      return { status: response.data.status };
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      return this.handleError(error, `GET /internal/orgs/${orgId}/status`, correlationId);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

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

  private handleError(error: unknown, operation: string, correlationId: string): never {
    if (error instanceof TimeoutError) {
      this.logger.http({
        type: 'internal-response',
        target: 'org-service',
        statusCode: 504,
        correlationId,
        message: `← [org-service] ${operation} 504: timed out after ${this.timeoutMs}ms`,
      });
      throw new GatewayTimeoutException('org-service did not respond in time');
    }

    const err     = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status  = err?.response?.status;
    const message = err?.response?.data?.message ?? err?.message ?? 'Unknown error';

    this.logger.http({
      type: 'internal-response',
      target: 'org-service',
      statusCode: status ?? 500,
      correlationId,
      message: `← [org-service] ${operation} ${status ?? 500}: ${message}`,
    });

    if (status === 404) {
      throw new NotFoundException(message);
    }

    throw new InternalServerErrorException(
      `Could not fetch from org-service (${operation})`,
    );
  }
}

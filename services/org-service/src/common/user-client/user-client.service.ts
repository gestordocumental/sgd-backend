import {
  Injectable,
  InternalServerErrorException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, retry, throwError, timer, timeout, TimeoutError } from 'rxjs';
import { CORRELATION_ID_HEADER, getCorrelationId } from '@sgd/common';
import CircuitBreaker = require('opossum');

@Injectable()
export class UserClientService {
  private readonly userServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs = 5_000;
  private readonly cb: CircuitBreaker;
  private readonly logger = new Logger(UserClientService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
  ) {
    this.userServiceUrl = config.getOrThrow<string>('USER_SERVICE_URL');
    this.internalToken  = config.getOrThrow<string>('INTERNAL_TOKEN_ORG_USER');

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'user-service',
        timeout:                  false,   // RxJS timeout() handles per-request timeouts
        errorThresholdPercentage: 50,
        resetTimeout:             30_000,
        volumeThreshold:          3,
        // 4xx errors are deterministic — don't trip the circuit.
        errorFilter: (err: any) => {
          const s = err?.response?.status;
          return typeof s === 'number' && s >= 400 && s < 500;
        },
      },
    );

    this.cb.on('open',     () => this.logger.warn('[circuit] user-service OPEN — failing fast'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] user-service HALF-OPEN — probing'));
    this.cb.on('close',    () => this.logger.log('[circuit] user-service CLOSED — recovered'));
  }

  /**
   * Revokes all user memberships for a deleted org.
   * 404 is treated as success (already revoked — idempotent).
   * Retries up to 2 times with exponential backoff on 5xx and network errors before
   * allowing the caller to compensate (restore the soft-deleted org).
   * Timeouts and 4xx errors are not retried — they are deterministic failures.
   */
  async revokeOrgAccess(orgId: string): Promise<void> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/api/v1/users/internal/orgs/${orgId}/users`;
    const RETRY_COUNT   = 2;
    const RETRY_BASE_MS = 500;

    try {
      await this.fireWithCb(() =>
        firstValueFrom(
          this.httpService
            .delete(url, {
              headers: {
                'x-internal-token':      this.internalToken,
                [CORRELATION_ID_HEADER]: correlationId,
              },
            })
            .pipe(
              timeout(this.timeoutMs),
              retry({
                count: RETRY_COUNT,
                delay: (error: any, attempt: number) => {
                  // Don't retry on timeout — service is unresponsive, not transiently failing
                  if (error instanceof TimeoutError) return throwError(() => error);
                  // Don't retry on 4xx — deterministic client/business errors
                  const status = error?.response?.status;
                  if (typeof status === 'number' && status >= 400 && status < 500) {
                    return throwError(() => error);
                  }
                  // Retry 5xx and network errors with exponential backoff
                  const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
                  this.logger.warn(
                    `revokeOrgAccess for ${orgId} failed (attempt ${attempt + 1}/${RETRY_COUNT + 1}), retrying in ${delayMs}ms`,
                  );
                  return timer(delayMs);
                },
              }),
            ),
        ),
      );
    } catch (error: any) {
      if (error instanceof ServiceUnavailableException) throw error;

      if (error instanceof TimeoutError) {
        this.logger.error(`Timeout revoking org access for ${orgId}`);
        throw new GatewayTimeoutException('Timeout revoking user access after org deletion');
      }

      const status = error?.response?.status;
      if (status === 404) return; // already revoked — idempotent

      this.logger.error(`Failed to revoke org access for ${orgId}: HTTP ${status ?? 'N/A'}`);
      throw new InternalServerErrorException('Failed to revoke user access after org deletion');
    }
  }

  private async fireWithCb<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.cb.fire(fn) as T;
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER') {
        throw new ServiceUnavailableException('user-service is temporarily unavailable');
      }
      throw err;
    }
  }
}

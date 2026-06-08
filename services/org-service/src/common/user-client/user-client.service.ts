import {
  Injectable,
  InternalServerErrorException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
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
   * Throws on timeout or 5xx so the caller can compensate (restore the soft-deleted org).
   */
  async revokeOrgAccess(orgId: string): Promise<void> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/api/v1/users/internal/orgs/${orgId}/users`;

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
            .pipe(timeout(this.timeoutMs)),
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

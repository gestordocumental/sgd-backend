import {
  Injectable,
  InternalServerErrorException,
  GatewayTimeoutException,
  ServiceUnavailableException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { CORRELATION_ID_HEADER, getCorrelationId, isNonTrippingClientError } from '@sgd/common';
import CircuitBreaker = require('opossum');

// Re-exported for this file's existing spec import — the actual definition
// (and its circuit-breaker-policy reasoning) now lives in @sgd/common,
// shared with every other internal HTTP client instead of forked per file.
export { isNonTrippingClientError };

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
        errorFilter: (err: any) => isNonTrippingClientError(err?.response?.status),
      },
    );

    this.cb.on('open',     () => this.logger.warn('[circuit] user-service OPEN — failing fast'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] user-service HALF-OPEN — probing'));
    this.cb.on('close',    () => this.logger.log('[circuit] user-service CLOSED — recovered'));
  }

  /**
   * Revokes all user memberships for a deleted org.
   * 404 is treated as success (already revoked — idempotent).
   * Retries up to 2 times with exponential backoff on 5xx and network errors.
   * Timeouts and 4xx errors are not retried — they are deterministic failures.
   */
  async revokeOrgAccess(orgId: string): Promise<void> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/api/v1/users/internal/orgs/${orgId}/users`;
    const RETRY_COUNT   = 2;
    const RETRY_BASE_MS = 500;

    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
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
        return; // success
      } catch (error: any) {
        if (error instanceof ServiceUnavailableException) throw error;

        if (error instanceof TimeoutError) {
          this.logger.error(`Timeout revoking org access for ${orgId}`);
          throw new GatewayTimeoutException('Timeout revoking user access after org deletion');
        }

        const status = error?.response?.status;
        if (status === 404) return; // already revoked — idempotent

        // 4xx errors are deterministic — don't retry
        const retryable = typeof status !== 'number' || status >= 500;
        if (!retryable || attempt === RETRY_COUNT) {
          this.logger.error(`Failed to revoke org access for ${orgId}: HTTP ${status ?? 'N/A'}`);
          throw new InternalServerErrorException('Failed to revoke user access after org deletion');
        }

        const delayMs = RETRY_BASE_MS * Math.pow(2, attempt);
        this.logger.warn(
          `revokeOrgAccess for ${orgId} failed (attempt ${attempt + 1}/${RETRY_COUNT + 1}), retrying in ${delayMs}ms`,
        );
        await this.sleep(delayMs);
      }
    }
  }

  /**
   * Returns the IDs of users currently (non-removed) assigned to orgId.
   * Used to proactively revoke sessions when an org is deactivated — best-effort,
   * callers should treat failures as non-fatal to the org status change itself.
   */
  async getActiveUserIds(orgId: string): Promise<string[]> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/api/v1/users/internal/orgs/${orgId}/user-ids`;

    const response = await this.fireWithCb<{ data: { userIds: string[] } }>(() =>
      firstValueFrom(
        this.httpService
          .get<{ userIds: string[] }>(url, {
            headers: {
              'x-internal-token':      this.internalToken,
              [CORRELATION_ID_HEADER]: correlationId,
            },
          })
          .pipe(timeout(this.timeoutMs)),
      ),
    );
    return response.data.userIds;
  }

  /**
   * Counts non-deleted users whose profile references the given
   * departamento/area/cargo — used to block deleting a position in
   * org-service that a user still points to (see CargosService/AreasService/
   * DepartamentosService.remove()). Exactly one of the filter fields must be
   * set — this mirrors the id being deleted at the caller's level.
   *
   * orgId scopes the count to users who are currently active members of
   * that specific org — mirrors DocumentClientService's already-orgId-scoped
   * equivalent. Matters concretely, not just for symmetry: a user's
   * departamentoId/areaId/cargoId live directly on their profile with no
   * org_id alongside them, and removing a user from an org never clears
   * those fields — without this, a user long removed from org A but still
   * carrying org A's stale cargoId would wrongly count as a live reference
   * and block deleting that cargo.
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
    const url = `${this.userServiceUrl}/internal/users/org-structure-references?${params.toString()}`;

    try {
      const response = await this.fireWithCb(() =>
        firstValueFrom(
          this.httpService
            .get<{ count: number }>(url, {
              headers: {
                'x-internal-token':      this.internalToken,
                [CORRELATION_ID_HEADER]: correlationId,
              },
            })
            .pipe(timeout(this.timeoutMs)),
        ),
      );

      // See DocumentClientService.countOrgStructureReferences() for why this
      // must fail closed instead of trusting the .get<{count}>() type
      // annotation: a 200 with a missing/non-numeric `count` would otherwise
      // become `undefined` here, and `undefined > 0` is false at every
      // caller — silently letting a delete through as if zero references
      // existed. Number.isSafeInteger() + >= 0, not just isFinite(): a
      // count: -1 would also read as "no references" (`-1 > 0` is false),
      // and this is a DB count — only a non-negative integer is ever valid.
      if (!Number.isSafeInteger(response.data?.count) || response.data.count < 0) {
        throw new InternalServerErrorException(
          'user-service returned a malformed org-structure-references response (missing or non-numeric count)',
        );
      }

      return response.data.count;
    } catch (error: any) {
      if (error instanceof InternalServerErrorException) throw error;
      if (error instanceof ServiceUnavailableException) throw error;

      if (error instanceof TimeoutError) {
        this.logger.error(`Timeout checking org-structure references in user-service`);
        throw new GatewayTimeoutException('user-service did not respond in time');
      }

      const status  = error?.response?.status;
      const message = error?.response?.data?.message ?? error?.message ?? 'Unknown error';

      if (typeof status === 'number' && status >= 400 && status < 500) {
        throw new HttpException(message, status);
      }
      this.logger.error(`Failed to check org-structure references in user-service: HTTP ${status ?? 'N/A'}`);
      throw new InternalServerErrorException(
        `Could not check user references from user-service: ${message}`,
      );
    }
  }

  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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

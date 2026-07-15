import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout } from 'rxjs';
import { AppLogger, getCorrelationId, CORRELATION_ID_HEADER } from '@sgd/common';
import CircuitBreaker = require('opossum');

// No email — this hits batch-display-names, a contract deliberately scoped to
// display names only (see user-service's internal-users.controller.ts).
// Audit log actors are shown to any viewer holding AUDIT:READ regardless of
// USERS:READ, so this client must never receive (and can't leak) email.
export interface UserDisplayName {
  id: string;
  displayName: string | null;
}

@Injectable()
export class UserClientService {
  private readonly userServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs = 5_000;
  private readonly cb: CircuitBreaker;

  // user-service's batch-display-names endpoint rejects requests over 500 ids.
  private static readonly BATCH_SIZE = 500;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.userServiceUrl = this.config.getOrThrow<string>('USER_SERVICE_URL');
    this.internalToken  = this.config.getOrThrow<string>('INTERNAL_TOKEN_AUDIT_USER');

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'user-service',
        timeout:                  false, // RxJS timeout() handles per-request timeouts
        errorThresholdPercentage: 75,
        resetTimeout:             10_000,
        volumeThreshold:          10,
      },
    );
    this.cb.on('open',     () => this.logger.warn('[circuit] user-service OPEN — failing fast', 'UserClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] user-service HALF-OPEN — probing', 'UserClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] user-service CLOSED — recovered', 'UserClientService'));
  }

  /**
   * Resolves display names for a batch of actor IDs — used to show who
   * performed each audit event without requiring the viewer to hold
   * USERS:READ (an unrelated permission). Best-effort: on any failure,
   * returns an empty map so audit logs still render (falling back to the
   * raw actorId) instead of becoming unavailable because name resolution failed.
   *
   * Splits into chunks of at most 500 ids (the endpoint's own limit) —
   * without this, exporting more actors than that in one request would send
   * a single oversized request that user-service rejects outright.
   */
  async getUsersByIds(userIds: string[]): Promise<Map<string, UserDisplayName>> {
    if (userIds.length === 0) return new Map();

    const batches: string[][] = [];
    for (let i = 0; i < userIds.length; i += UserClientService.BATCH_SIZE) {
      batches.push(userIds.slice(i, i + UserClientService.BATCH_SIZE));
    }

    const batchResults = await Promise.all(batches.map((batch) => this.fetchUserBatch(batch)));
    const merged = new Map<string, UserDisplayName>();
    for (const batchResult of batchResults) {
      for (const [id, user] of batchResult) merged.set(id, user);
    }
    return merged;
  }

  private async fetchUserBatch(userIds: string[]): Promise<Map<string, UserDisplayName>> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/internal/users/batch-display-names`;

    try {
      const response = await (this.cb.fire(() =>
        firstValueFrom(
          this.httpService
            .post<UserDisplayName[]>(
              url,
              { ids: userIds },
              {
                headers: {
                  'x-internal-token':      this.internalToken,
                  [CORRELATION_ID_HEADER]: correlationId,
                },
              },
            )
            .pipe(timeout(this.timeoutMs)),
        ),
      ) as Promise<{ data: UserDisplayName[] }>);
      return new Map(response.data.map((u) => [u.id, u]));
    } catch (error: unknown) {
      this.logger.warn(
        `Could not resolve actor names (${userIds.length} ids): ${
          error instanceof Error ? error.message : String(error)
        }`,
        'UserClientService',
      );
      return new Map();
    }
  }
}

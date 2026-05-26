import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout } from 'rxjs';
import { AppLogger, getCorrelationId } from '@sgd/common';
import CircuitBreaker = require('opossum');

interface UserInfo {
  id: string;
  email: string;
  fullName: string;
}

@Injectable()
export class UserClientService {
  private readonly baseUrl: string;
  private readonly internalToken: string;
  private readonly cb: CircuitBreaker;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.baseUrl       = config.getOrThrow<string>('USER_SERVICE_URL');
    this.internalToken = config.getOrThrow<string>('INTERNAL_TOKEN_NOTIF_USER');

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'user-service',
        timeout:                  false,   // timeout applied per-request via RxJS pipe
        errorThresholdPercentage: 50,
        resetTimeout:             30_000,
        volumeThreshold:          3,
      },
    );
    this.cb.on('open',     () => this.logger.warn('[circuit] user-service OPEN — failing fast', 'UserClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] user-service HALF-OPEN — probing', 'UserClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] user-service CLOSED — recovered', 'UserClientService'));
  }

  async getUserById(userId: string): Promise<UserInfo | null> {
    if (this.cb.opened) {
      this.logger.warn(`[circuit] user-service circuit open — skipping getUserById(${userId})`, 'UserClientService');
      return null;
    }
    try {
      const result = await this.cb.fire(() =>
        firstValueFrom(
          this.http.get<UserInfo>(`${this.baseUrl}/api/users/${userId}`, {
            timeout: 3000,
            headers: {
              'x-internal-token': this.internalToken,
              'x-correlation-id': getCorrelationId(),
            },
          }).pipe(timeout(3000)),
        ),
      ) as { data: UserInfo };
      return result.data;
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER') {
        this.logger.warn(`[circuit] user-service circuit open — skipping getUserById(${userId})`, 'UserClientService');
        return null;
      }
      this.logger.warn(
        `Could not fetch user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        'UserClientService',
      );
      return null;
    }
  }

  async getUsersByIds(userIds: string[]): Promise<Map<string, UserInfo>> {
    if (!userIds.length) return new Map();
    if (this.cb.opened) {
      this.logger.warn('[circuit] user-service circuit open — skipping getUsersByIds batch', 'UserClientService');
      return new Map();
    }
    try {
      const result = await this.cb.fire(() =>
        firstValueFrom(
          this.http.post<UserInfo[]>(
            `${this.baseUrl}/internal/users/batch-by-ids`,
            { ids: userIds },
            {
              timeout: 5000,
              headers: {
                'x-internal-token': this.internalToken,
                'x-correlation-id': getCorrelationId(),
              },
            },
          ).pipe(timeout(5000)),
        ),
      ) as { data: UserInfo[] };
      const map = new Map<string, UserInfo>();
      result.data.forEach((u) => map.set(u.id, u));
      return map;
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER') {
        this.logger.warn('[circuit] user-service circuit open — skipping getUsersByIds batch', 'UserClientService');
        return new Map();
      }
      this.logger.warn(
        `Batch user fetch failed, falling back to individual calls: ${err instanceof Error ? err.message : String(err)}`,
        'UserClientService',
      );
      // Fallback: parallel individual calls
      const results = await Promise.all(userIds.map((id) => this.getUserById(id)));
      const map = new Map<string, UserInfo>();
      results.forEach((user, idx) => { if (user) map.set(userIds[idx], user); });
      return map;
    }
  }
}

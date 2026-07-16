import {
  Injectable,
  InternalServerErrorException,
  GatewayTimeoutException,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { AppLogger, getCorrelationId, CORRELATION_ID_HEADER } from '@sgd/common';
import CircuitBreaker = require('opossum');

export interface UserBasicInfo {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

// No email — this hits batch-display-names, a contract deliberately scoped to
// display names only (see internal-users.controller.ts). Workflow timeline
// and participant names are shown to any viewer regardless of USERS:READ, so
// this client must never receive (and can't leak) another user's email.
export interface UserDisplayName {
  id: string;
  displayName: string | null;
}

export interface UsersByPositionResult {
  users: UserBasicInfo[];
}

export interface UserExistsResult {
  exists: boolean;
  isActive: boolean;
}

@Injectable()
export class UserClientService {
  private readonly userServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs: number;
  private readonly cb: CircuitBreaker;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.userServiceUrl = this.config.getOrThrow<string>('USER_SERVICE_URL');
    this.internalToken  = this.config.getOrThrow<string>('INTERNAL_TOKEN_WORKFLOW_USER');
    const raw           = this.config.get<string | number>('USER_SERVICE_TIMEOUT_MS');
    const parsed        = raw == null ? 5_000 : Number(raw);
    this.timeoutMs      = Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000;

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'user-service',
        timeout:                  false,   // RxJS timeout() handles per-request timeouts
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
   * Obtiene usuarios que tienen un cargo/área/departamento específico.
   * Usado para determinar los usuarios finales de una tipología cuando el workflow es aprobado.
   *
   * Endpoint requerido en user-service:
   *   POST /internal/users/by-position
   *   Body: { orgId, cargoId?, areaId?, departamentoId? }
   */
  async getUsersByPosition(
    orgId: string,
    filters: { cargoId?: string; areaId?: string; departamentoId?: string },
  ): Promise<UsersByPositionResult> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/internal/users/by-position`;

    this.logger.http({
      type: 'internal-request',
      target: 'user-service',
      url,
      correlationId,
      message: `→ [user-service] POST /internal/users/by-position`,
    });

    try {
      const response = await this.fireWithCb<{ data: UsersByPositionResult }>(() =>
        firstValueFrom(
          this.httpService
            .post<UsersByPositionResult>(
              url,
              { orgId, ...filters },
              {
                headers: {
                  'x-internal-token':      this.internalToken,
                  [CORRELATION_ID_HEADER]: correlationId,
                },
              },
            )
            .pipe(timeout(this.timeoutMs)),
        ),
      );

      this.logger.http({
        type: 'internal-response',
        target: 'user-service',
        statusCode: 200,
        correlationId,
        message: `← [user-service] POST /internal/users/by-position 200 (${response.data.users.length} users)`,
      });

      return response.data;
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      return this.handleError(error, 'user-service', url, correlationId);
    }
  }

  /**
   * Verifica que un usuario existe y está activo antes de asignarlo como aprobador o paso admin.
   *
   * Endpoint requerido en user-service:
   *   GET /internal/users/:id/exists
   */
  async validateUserExists(userId: string): Promise<UserExistsResult> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/internal/users/${userId}/exists`;

    try {
      const response = await this.fireWithCb<{ data: UserExistsResult }>(() =>
        firstValueFrom(
          this.httpService
            .get<UserExistsResult>(url, {
              headers: {
                'x-internal-token':      this.internalToken,
                [CORRELATION_ID_HEADER]: correlationId,
              },
            })
            .pipe(timeout(this.timeoutMs)),
        ),
      );
      return response.data;
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      return this.handleError(error, 'user-service', url, correlationId);
    }
  }

  // user-service's batch-display-names endpoint rejects requests over 500 ids.
  private static readonly BATCH_SIZE = 500;

  /**
   * Resolves display names for a batch of user IDs — used to show who performed
   * each workflow timeline event without requiring the viewer to hold USERS:READ
   * (an unrelated permission). Best-effort: on any failure, returns an empty map
   * instead of throwing, so the timeline still renders (falling back to raw IDs)
   * rather than becoming unavailable because name resolution failed.
   *
   * Splits into chunks of at most 500 ids (the endpoint's own limit) — without
   * this, a workflow with more participants/actors than that would send a
   * single oversized request that user-service rejects outright, degrading
   * name resolution to empty for everyone instead of just the overflow.
   * Batches are resolved independently, so one failing batch doesn't discard
   * names that other batches successfully resolved.
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
      const response = await this.fireWithCb<{ data: UserDisplayName[] }>(() =>
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
      );
      return new Map(response.data.map((u) => [u.id, u]));
    } catch (error: unknown) {
      this.logger.warn(
        `Could not resolve user names for timeline (${userIds.length} ids): ${
          error instanceof Error ? error.message : String(error)
        }`,
        'UserClientService',
      );
      return new Map();
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

  private handleError(
    error: unknown,
    target: string,
    url: string,
    correlationId: string,
  ): never {
    if (error instanceof TimeoutError) {
      this.logger.http({
        type: 'internal-response',
        target,
        statusCode: 504,
        correlationId,
        message: `← [${target}] ${url} 504: timed out after ${this.timeoutMs}ms`,
      });
      throw new GatewayTimeoutException(`${target} did not respond in time`);
    }

    const err     = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status  = err?.response?.status;
    const message = err?.response?.data?.message ?? err?.message ?? 'Unknown error';

    this.logger.http({
      type: 'internal-response',
      target,
      statusCode: status ?? 500,
      correlationId,
      message: `← [${target}] ${url} ${status ?? 500}: ${message}`,
    });

    if (status === 400) throw new BadRequestException(message);
    if (status === 404) throw new NotFoundException('Resource not found');

    throw new InternalServerErrorException('An unexpected error occurred — please try again');
  }
}

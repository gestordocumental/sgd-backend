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

@Injectable()
export class UserClientService {
  private readonly userServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs = 15_000;
  private readonly cb: CircuitBreaker;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.userServiceUrl =
      this.configService.getOrThrow<string>("USER_SERVICE_URL");
    this.internalToken =
      this.configService.getOrThrow<string>("INTERNAL_TOKEN_AUTH_USER");

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'user-service',
        timeout:                  false,   // RxJS timeout() handles per-request timeouts
        errorThresholdPercentage: 75,
        resetTimeout:             10_000,
        volumeThreshold:          10,
        // 4xx = client/business errors (not found, forbidden, validation) — deterministic,
        // retrying would not help.  Only network failures and 5xx errors trip the circuit.
        errorFilter: (err: any) => {
          const s = err?.response?.status;
          return typeof s === 'number' && s >= 400 && s < 500;
        },
      },
    );

    this.cb.on('open',     () => this.logger.warn('[circuit] user-service OPEN — failing fast', 'UserClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] user-service HALF-OPEN — probing',  'UserClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] user-service CLOSED — recovered',   'UserClientService'));
  }

  async getUserCompanies(userId: string): Promise<string[]> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/api/v1/users/${userId}/companies`;

    this.logger.http({
      type: "internal-request",
      target: "user-service",
      url,
      correlationId,
      message: `→ [user-service] GET /api/users/${userId}/companies`,
    });

    try {
      const response = await this.fireWithCb<{ data: string[] }>(() =>
        firstValueFrom(
          this.httpService
            .get<string[]>(url, {
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
        target: "user-service",
        statusCode: 200,
        correlationId,
        message: `← [user-service] GET /api/users/${userId}/companies 200`,
      });

      return response.data;
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      return this.handleError(error, `GET /api/users/${userId}/companies`, correlationId);
    }
  }

  async getUserEffectivePermissions(
    userId: string,
    companyId: string,
  ): Promise<{ module: string; action: string }[]> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/api/v1/users/${userId}/effective-permissions?companyId=${companyId}`;

    this.logger.http({
      type: 'internal-request',
      target: 'user-service',
      url,
      correlationId,
      message: `→ [user-service] GET /api/users/${userId}/effective-permissions`,
    });

    try {
      const response = await this.fireWithCb<{ data: { module: string; action: string }[] }>(() =>
        firstValueFrom(
          this.httpService
            .get<{ module: string; action: string }[]>(url, {
              headers: {
                'x-internal-token': this.internalToken,
                [CORRELATION_ID_HEADER]: correlationId,
              },
            })
            .pipe(timeout(this.timeoutMs)),
        ),
      );

      this.logger.http({
        type: 'internal-response',
        target: 'user-service',
        statusCode: 200,
        correlationId,
        message: `← [user-service] GET /api/users/${userId}/effective-permissions 200`,
      });

      return response.data;
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      return this.handleError(error, `GET /api/users/${userId}/effective-permissions`, correlationId);
    }
  }

  async getUserInfo(userId: string): Promise<{ isSuperAdmin: boolean }> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/api/v1/users/${userId}`;

    this.logger.http({
      type: "internal-request",
      target: "user-service",
      url,
      correlationId,
      message: `→ [user-service] GET /api/users/${userId}`,
    });

    try {
      const response = await this.fireWithCb<{ data: { isSuperAdmin: boolean } }>(() =>
        firstValueFrom(
          this.httpService
            .get<{ isSuperAdmin: boolean }>(url, {
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
        target: "user-service",
        statusCode: 200,
        correlationId,
        message: `← [user-service] GET /api/users/${userId} 200`,
      });

      return { isSuperAdmin: response.data.isSuperAdmin ?? false };
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) throw error;
      return this.handleError(error, `GET /api/users/${userId}`, correlationId);
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async fireWithCb<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.cb.fire(fn) as T;
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER') {
        // Circuit is open — fast-fail so callers can use the Redis cache immediately
        // instead of waiting 3 s per request while user-service is down.
        throw new ServiceUnavailableException('user-service is temporarily unavailable');
      }
      throw err;
    }
  }

  private handleError(error: unknown, operation: string, correlationId: string): never {
    if (error instanceof TimeoutError) {
      this.logger.http({
        type: 'internal-response',
        target: 'user-service',
        statusCode: 504,
        correlationId,
        message: `← [user-service] ${operation} 504: timed out after ${this.timeoutMs}ms`,
      });
      throw new GatewayTimeoutException('user-service did not respond in time');
    }

    const err     = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status  = err?.response?.status;
    const message = err?.response?.data?.message ?? err?.message ?? 'Unknown error';

    this.logger.http({
      type: 'internal-response',
      target: 'user-service',
      statusCode: status ?? 500,
      correlationId,
      message: `← [user-service] ${operation} ${status ?? 500}: ${message}`,
    });

    if (status === 404) {
      throw new NotFoundException(message);
    }

    throw new InternalServerErrorException(
      `Could not fetch from user-service (${operation}): ${message}`,
    );
  }
}

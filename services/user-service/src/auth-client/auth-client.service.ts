import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom, retry, throwError, timer, timeout, TimeoutError } from "rxjs";
import { AppLogger, getCorrelationId, CORRELATION_ID_HEADER } from '@sgd/common';
import CircuitBreaker = require('opossum');

export interface ProvisionPayload {
  userId: string;
  email: string;
  password: string;
}

@Injectable()
export class AuthClientService {
  private readonly authServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs = 5_000;
  private readonly cb: CircuitBreaker;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.authServiceUrl = this.configService.getOrThrow<string>("AUTH_SERVICE_URL");
    this.internalToken  = this.configService.getOrThrow<string>("INTERNAL_TOKEN_USER_AUTH");

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'auth-service',
        timeout:                  false,   // RxJS timeout() handles per-request timeouts
        errorThresholdPercentage: 50,
        resetTimeout:             30_000,
        volumeThreshold:          3,
        // 4xx errors are deterministic client/business errors — don't trip the circuit.
        errorFilter: (err: any) => {
          const s = err?.response?.status;
          return typeof s === 'number' && s >= 400 && s < 500;
        },
      },
    );

    this.cb.on('open',     () => this.logger.warn('[circuit] auth-service OPEN — failing fast', 'AuthClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] auth-service HALF-OPEN — probing',  'AuthClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] auth-service CLOSED — recovered',   'AuthClientService'));
  }

  async provisionCredentials(payload: ProvisionPayload): Promise<void> {
    const correlationId = getCorrelationId();
    const url = `${this.authServiceUrl}/api/v1/auth/credentials/provision`;

    this.logger.http({
      type: "internal-request",
      target: "auth-service",
      url,
      correlationId,
      message: `→ [auth-service] POST /api/v1/auth/credentials/provision`,
    });

    try {
      const response = await this.fireWithCb(() =>
        firstValueFrom(
          this.httpService.post(url, payload, {
            headers: {
              "x-internal-token": this.internalToken,
              "Content-Type": "application/json",
              [CORRELATION_ID_HEADER]: correlationId,
            },
          }).pipe(timeout(this.timeoutMs)),
        ),
      );

      this.logger.http({
        type: "internal-response",
        target: "auth-service",
        statusCode: response.status,
        correlationId,
        message: `← [auth-service] POST /api/v1/auth/credentials/provision ${response.status}`,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;

      if (error instanceof TimeoutError) {
        this.logger.http({
          type: "internal-response", target: "auth-service", statusCode: 504, correlationId,
          message: `← [auth-service] POST /api/v1/auth/credentials/provision 504: timed out`,
        });
        throw new GatewayTimeoutException('auth-service did not respond in time');
      }

      const axiosError = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
      const status  = axiosError?.response?.status;
      const message = axiosError?.response?.data?.message ?? axiosError?.message ?? "Unknown error";

      this.logger.http({
        type: "internal-response", target: "auth-service",
        statusCode: status ?? 500, correlationId,
        message: `← [auth-service] POST /api/v1/auth/credentials/provision ${status ?? 500}: ${message}`,
      });

      if (status && status >= 400 && status < 500) throw new HttpException(message, status);
      throw new BadGatewayException(`Could not create credentials in auth-service`);
    }
  }

  async disableCredentials(userId: string): Promise<void> {
    await this.internalPatch(`/api/v1/auth/credentials/${userId}/disable`);
  }

  async enableCredentials(userId: string): Promise<void> {
    await this.internalPatch(`/api/v1/auth/credentials/${userId}/enable`);
  }

  async revokeAllTokens(userId: string): Promise<void> {
    await this.internalPatch(`/api/v1/auth/credentials/${userId}/revoke-tokens`);
  }

  private async internalPatch(path: string): Promise<void> {
    const correlationId = getCorrelationId();
    const url = `${this.authServiceUrl}${path}`;

    this.logger.http({
      type: "internal-request", target: "auth-service", url, correlationId,
      message: `→ [auth-service] PATCH ${path}`,
    });

    // Retry up to 2 times (3 total) with exponential backoff for 5xx/network errors.
    // Timeouts and 4xx are not retried — timeouts trip the circuit; 4xx are deterministic.
    const RETRY_COUNT   = 2;
    const RETRY_BASE_MS = 500;

    try {
      const response = await this.fireWithCb(() =>
        firstValueFrom(
          this.httpService.patch(url, {}, {
            headers: {
              "x-internal-token": this.internalToken,
              [CORRELATION_ID_HEADER]: correlationId,
            },
          }).pipe(
            timeout(this.timeoutMs),
            retry({
              count: RETRY_COUNT,
              delay: (error: any, attempt: number) => {
                if (error instanceof TimeoutError) return throwError(() => error);
                const status = error?.response?.status;
                if (typeof status === 'number' && status >= 400 && status < 500) {
                  return throwError(() => error);
                }
                const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
                this.logger.warn(
                  `[auth-service] PATCH ${path} failed (attempt ${attempt + 1}/${RETRY_COUNT + 1}), retrying in ${delayMs}ms`,
                  'AuthClientService',
                );
                return timer(delayMs);
              },
            }),
          ),
        ),
      );

      this.logger.http({
        type: "internal-response", target: "auth-service",
        statusCode: response.status, correlationId,
        message: `← [auth-service] PATCH ${path} ${response.status}`,
      });
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;

      if (error instanceof TimeoutError) {
        this.logger.http({
          type: "internal-response", target: "auth-service", statusCode: 504, correlationId,
          message: `← [auth-service] PATCH ${path} 504: timed out after ${this.timeoutMs}ms`,
        });
        throw new GatewayTimeoutException('auth-service did not respond in time');
      }

      const axiosError = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
      const status  = axiosError?.response?.status;
      const message = axiosError?.response?.data?.message ?? axiosError?.message ?? "Unknown error";

      this.logger.http({
        type: "internal-response", target: "auth-service",
        statusCode: status ?? 500, correlationId,
        message: `← [auth-service] PATCH ${path} ${status ?? 500}: ${message}`,
      });

      if (status && status >= 400 && status < 500) throw new HttpException(message, status);
      throw new BadGatewayException(`Could not update credentials in auth-service`);
    }
  }

  private async fireWithCb<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await this.cb.fire(fn) as T;
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER') {
        throw new ServiceUnavailableException('auth-service is temporarily unavailable');
      }
      throw err;
    }
  }
}

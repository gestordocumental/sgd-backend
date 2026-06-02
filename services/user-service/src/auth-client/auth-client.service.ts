import {
  BadGatewayException,
  HttpException,
  Injectable,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom, retry, throwError, timer } from "rxjs";
import { AppLogger, getCorrelationId, CORRELATION_ID_HEADER } from '@sgd/common';

export interface ProvisionPayload {
  userId: string;
  email: string;
  password: string;
}

@Injectable()
export class AuthClientService {
  private readonly authServiceUrl: string;
  private readonly internalToken: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.authServiceUrl =
      this.configService.getOrThrow<string>("AUTH_SERVICE_URL");
    this.internalToken =
      this.configService.getOrThrow<string>("INTERNAL_TOKEN_USER_AUTH");
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
      const response = await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            "x-internal-token": this.internalToken,
            "Content-Type": "application/json",
            // Forward correlationId so auth-service logs share the same ID
            [CORRELATION_ID_HEADER]: correlationId,
          },
        }),
      );

      this.logger.http({
        type: "internal-response",
        target: "auth-service",
        statusCode: response.status,
        correlationId,
        message: `← [auth-service] POST /api/v1/auth/credentials/provision ${response.status}`,
      });
    } catch (error) {
      const axiosError = error as {
        response?: { status?: number; data?: { message?: string } };
        message?: string;
      };
      const status = axiosError?.response?.status;
      const message =
        axiosError?.response?.data?.message ??
        axiosError?.message ??
        "Unknown error";

      this.logger.http({
        type: "internal-response",
        target: "auth-service",
        statusCode: status ?? 500,
        correlationId,
        message: `← [auth-service] POST /api/v1/auth/credentials/provision ${status ?? 500}: ${message}`,
      });

      if (status && status >= 400 && status < 500) {
        throw new HttpException(message, status);
      }

      throw new BadGatewayException(
        `Could not create credentials in auth-service`,
      );
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
      type: "internal-request",
      target: "auth-service",
      url,
      correlationId,
      message: `→ [auth-service] PATCH ${path}`,
    });

    // Retry up to 2 times (3 total attempts) with exponential backoff (500 ms, 1 000 ms)
    // before propagating the error.  4xx errors are never retried — they are
    // deterministic (e.g. invalid token, resource not found) and retrying would not help.
    const RETRY_COUNT   = 2;
    const RETRY_BASE_MS = 500;

    try {
      const response = await firstValueFrom(
        this.httpService.patch(url, {}, {
          headers: {
            "x-internal-token": this.internalToken,
            [CORRELATION_ID_HEADER]: correlationId,
          },
        }).pipe(
          retry({
            count: RETRY_COUNT,
            delay: (error: any, attempt: number) => {
              const status = error?.response?.status;
              if (typeof status === 'number' && status >= 400 && status < 500) {
                return throwError(() => error); // 4xx — do not retry
              }
              const delayMs = RETRY_BASE_MS * Math.pow(2, attempt - 1);
              this.logger.warn(
                `[auth-service] PATCH ${path} failed (attempt ${attempt}/${RETRY_COUNT}), retrying in ${delayMs}ms`,
                'AuthClientService',
              );
              return timer(delayMs);
            },
          }),
        ),
      );

      this.logger.http({
        type: "internal-response",
        target: "auth-service",
        statusCode: response.status,
        correlationId,
        message: `← [auth-service] PATCH ${path} ${response.status}`,
      });
    } catch (error) {
      const axiosError = error as {
        response?: { status?: number; data?: { message?: string } };
        message?: string;
      };
      const status = axiosError?.response?.status;
      const message =
        axiosError?.response?.data?.message ??
        axiosError?.message ??
        "Unknown error";

      this.logger.http({
        type: "internal-response",
        target: "auth-service",
        statusCode: status ?? 500,
        correlationId,
        message: `← [auth-service] PATCH ${path} ${status ?? 500}: ${message}`,
      });

      if (status && status >= 400 && status < 500) {
        throw new HttpException(message, status);
      }

      throw new BadGatewayException(`Could not update credentials in auth-service`);
    }
  }
}

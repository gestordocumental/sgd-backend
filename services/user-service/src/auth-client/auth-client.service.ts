import {
  BadGatewayException,
  HttpException,
  Injectable,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { AppLogger } from "../common/logger/app-logger.service";
import { getCorrelationId } from "../common/correlation/correlation.context";
import { CORRELATION_ID_HEADER } from "../common/middleware/correlation.middleware";

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
      this.configService.getOrThrow<string>("INTERNAL_TOKEN");
  }

  async provisionCredentials(payload: ProvisionPayload): Promise<void> {
    const correlationId = getCorrelationId();
    const url = `${this.authServiceUrl}/api/auth/credentials/provision`;

    this.logger.http({
      type: "internal-request",
      target: "auth-service",
      url,
      correlationId,
      message: `→ [auth-service] POST /api/auth/credentials/provision`,
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
        message: `← [auth-service] POST /api/auth/credentials/provision ${response.status}`,
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
        message: `← [auth-service] POST /api/auth/credentials/provision ${status ?? 500}: ${message}`,
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
    await this.internalPatch(`/api/auth/credentials/${userId}/disable`);
  }

  async enableCredentials(userId: string): Promise<void> {
    await this.internalPatch(`/api/auth/credentials/${userId}/enable`);
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

    try {
      const response = await firstValueFrom(
        this.httpService.patch(url, {}, {
          headers: {
            "x-internal-token": this.internalToken,
            [CORRELATION_ID_HEADER]: correlationId,
          },
        }),
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

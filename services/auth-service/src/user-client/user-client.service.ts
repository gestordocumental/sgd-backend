import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { ConfigService } from "@nestjs/config";
import { firstValueFrom } from "rxjs";
import { AppLogger } from "../common/logger/app-logger.service";
import { getCorrelationId } from "../common/correlation/correlation.context";
import { CORRELATION_ID_HEADER } from "../common/middleware/correlation.middleware";

@Injectable()
export class UserClientService {
  private readonly userServiceUrl: string;
  private readonly internalToken: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.userServiceUrl =
      this.configService.getOrThrow<string>("USER_SERVICE_URL");
    this.internalToken =
      this.configService.getOrThrow<string>("INTERNAL_TOKEN");
  }

  async getUserCompanies(userId: string): Promise<string[]> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/api/users/${userId}/companies`;

    this.logger.http({
      type: "internal-request",
      target: "user-service",
      url,
      correlationId,
      message: `→ [user-service] GET /api/users/${userId}/companies`,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.get<string[]>(url, {
          headers: {
            "x-internal-token": this.internalToken,
            [CORRELATION_ID_HEADER]: correlationId,
          },
        }),
      );

      this.logger.http({
        type: "internal-response",
        target: "user-service",
        statusCode: 200,
        correlationId,
        message: `← [user-service] GET /api/users/${userId}/companies 200`,
      });

      return response.data;
    } catch (error: any) {
      const status = error?.response?.status;
      const message =
        error?.response?.data?.message ?? error?.message ?? "Unknown error";

      if (status === 404) {
        throw new NotFoundException(`User ${userId} not found in user-service`);
      }
      throw new InternalServerErrorException(
        `Could not fetch user info from user-service: ${message}`,
      );
    }
  }

  async getUserInfo(userId: string): Promise<{ isSuperAdmin: boolean }> {
    const correlationId = getCorrelationId();
    const url = `${this.userServiceUrl}/api/users/${userId}`;

    this.logger.http({
      type: "internal-request",
      target: "user-service",
      url,
      correlationId,
      message: `→ [user-service] GET /api/users/${userId}`,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.get<{ isSuperAdmin: boolean }>(url, {
          headers: {
            "x-internal-token": this.internalToken,
            [CORRELATION_ID_HEADER]: correlationId,
          },
        }),
      );

      this.logger.http({
        type: "internal-response",
        target: "user-service",
        statusCode: 200,
        correlationId,
        message: `← [user-service] GET /api/users/${userId} 200`,
      });

      return { isSuperAdmin: response.data.isSuperAdmin ?? false };
    } catch (error: any) {
      const status = error?.response?.status;
      const message =
        error?.response?.data?.message ?? error?.message ?? "Unknown error";

      this.logger.http({
        type: "internal-response",
        target: "user-service",
        statusCode: status ?? 500,
        correlationId,
        message: `← [user-service] GET /api/users/${userId} ${status ?? 500}: ${message}`,
      });

      if (status === 404) {
        throw new NotFoundException(`User ${userId} not found in user-service`);
      }

      throw new InternalServerErrorException(
        `Could not fetch user info from user-service: ${message}`,
      );
    }
  }
}

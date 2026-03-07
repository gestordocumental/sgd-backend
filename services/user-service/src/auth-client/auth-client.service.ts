import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppLogger } from '../common/logger/app-logger.service';
import { getCorrelationId } from '../common/correlation/correlation.context';
import { CORRELATION_ID_HEADER } from '../common/middleware/correlation.middleware';

export interface ProvisionPayload {
  companyId: string;
  userId:    string;
  email:     string;
  password:  string;
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
    this.authServiceUrl = this.configService.getOrThrow<string>('AUTH_SERVICE_URL');
    this.internalToken  = this.configService.getOrThrow<string>('INTERNAL_TOKEN');
  }

  async provisionCredentials(payload: ProvisionPayload): Promise<void> {
    const correlationId = getCorrelationId();
    const url = `${this.authServiceUrl}/api/auth/credentials/provision`;

    this.logger.http({
      type:          'internal-request',
      target:        'auth-service',
      url,
      correlationId,
      message:       `→ [auth-service] POST /api/auth/credentials/provision`,
    });

    try {
      await firstValueFrom(
        this.httpService.post(url, payload, {
          headers: {
            'x-internal-token':       this.internalToken,
            'Content-Type':           'application/json',
            // Forward correlationId so auth-service logs share the same ID
            [CORRELATION_ID_HEADER]:  correlationId,
          },
        }),
      );

      this.logger.http({
        type:          'internal-response',
        target:        'auth-service',
        statusCode:    200,
        correlationId,
        message:       `← [auth-service] POST /api/auth/credentials/provision 200`,
      });
    } catch (error) {
      const axiosError = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
      const status  = axiosError?.response?.status;
      const message = axiosError?.response?.data?.message ?? axiosError?.message ?? 'Unknown error';

      this.logger.http({
        type:          'internal-response',
        target:        'auth-service',
        statusCode:    status ?? 500,
        correlationId,
        message:       `← [auth-service] POST /api/auth/credentials/provision ${status ?? 500}: ${message}`,
      });

      throw new InternalServerErrorException(
        `Could not create credentials in auth-service: ${message}`,
      );
    }
  }
}

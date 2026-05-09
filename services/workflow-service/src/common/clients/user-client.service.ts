import {
  Injectable,
  InternalServerErrorException,
  GatewayTimeoutException,
  BadRequestException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { AppLogger } from '../logger/app-logger.service';
import { getCorrelationId } from '../correlation/correlation.context';
import { CORRELATION_ID_HEADER } from '../middleware/correlation.middleware';

export interface UserBasicInfo {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
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

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.userServiceUrl = this.config.getOrThrow<string>('USER_SERVICE_URL');
    this.internalToken  = this.config.getOrThrow<string>('INTERNAL_TOKEN');
    const raw           = this.config.get<string | number>('USER_SERVICE_TIMEOUT_MS');
    const parsed        = raw == null ? 5_000 : Number(raw);
    this.timeoutMs      = Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000;
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
      const response = await firstValueFrom(
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
      const response = await firstValueFrom(
        this.httpService
          .get<UserExistsResult>(url, {
            headers: {
              'x-internal-token':      this.internalToken,
              [CORRELATION_ID_HEADER]: correlationId,
            },
          })
          .pipe(timeout(this.timeoutMs)),
      );
      return response.data;
    } catch (error: unknown) {
      return this.handleError(error, 'user-service', url, correlationId);
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
    if (status === 404) throw new BadRequestException(`Resource not found in ${target}: ${message}`);

    throw new InternalServerErrorException(`Error communicating with ${target}: ${message}`);
  }
}

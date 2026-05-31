import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { AppLogger, CORRELATION_ID_HEADER, getCorrelationId } from '@sgd/common';

@Injectable()
export class OrgClientService {
  private readonly orgServiceUrl: string | undefined;
  private readonly internalToken: string | undefined;
  private readonly timeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.orgServiceUrl = this.config.get<string>('ORG_SERVICE_URL');
    this.internalToken = this.config.get<string>('INTERNAL_TOKEN_USER_ORG');
    const rawTimeout = this.config.get<string | number>('ORG_SERVICE_TIMEOUT_MS');
    const parsedTimeout = rawTimeout == null ? 5_000 : Number(rawTimeout);
    this.timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : 5_000;

    if (!this.orgServiceUrl) {
      this.logger.warn(
        'ORG_SERVICE_URL not configured — org-structure validation on user updates is disabled',
        'OrgClientService',
      );
    }
  }

  /**
   * Resolves human-readable names for org-structure UUIDs.
   * Returns null silently on any error (non-configured, deleted entities, timeout)
   * so callers can fall back to raw IDs rather than failing the main operation.
   */
  async resolveNamesById(
    orgId: string,
    departamentoId: string,
    areaId?: string | null,
    cargoId?: string | null,
  ): Promise<{
    departamentoNombre: string;
    areaNombre: string | null;
    cargoNombre: string | null;
  } | null> {
    if (!this.orgServiceUrl || !this.internalToken) return null;
    try {
      const correlationId = getCorrelationId();
      const response = await firstValueFrom(
        this.httpService
          .post<{
            departamentoNombre: string;
            areaNombre: string | null;
            cargoNombre: string | null;
          }>(
            `${this.orgServiceUrl}/internal/structure/resolve-by-ids`,
            { orgId, departamentoId, areaId: areaId ?? undefined, cargoId: cargoId ?? undefined },
            {
              headers: {
                'x-internal-token': this.internalToken,
                [CORRELATION_ID_HEADER]: correlationId,
              },
            },
          )
          .pipe(timeout(this.timeoutMs)),
      );
      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Validates that the given org-structure IDs exist and belong to the specified org.
   * Throws BadRequestException with the org-service error message if any ID is invalid.
   * Skips silently when ORG_SERVICE_URL / INTERNAL_TOKEN_USER_ORG are not configured.
   */
  async validateOrgStructure(
    orgId: string,
    departamentoId: string,
    areaId?: string,
    cargoId?: string,
  ): Promise<void> {
    if (!this.orgServiceUrl || !this.internalToken) return;

    const correlationId = getCorrelationId();
    const url = `${this.orgServiceUrl}/internal/structure/resolve-by-ids`;

    this.logger.http({
      type: 'internal-request',
      target: 'org-service',
      url,
      correlationId,
      message: `→ [org-service] POST /internal/structure/resolve-by-ids (validate)`,
    });

    try {
      await firstValueFrom(
        this.httpService
          .post(
            url,
            { orgId, departamentoId, areaId, cargoId },
            {
              headers: {
                'x-internal-token': this.internalToken,
                [CORRELATION_ID_HEADER]: correlationId,
              },
            },
          )
          .pipe(timeout(this.timeoutMs)),
      );

      this.logger.http({
        type: 'internal-response',
        target: 'org-service',
        statusCode: 200,
        correlationId,
        message: `← [org-service] POST /internal/structure/resolve-by-ids 200`,
      });
    } catch (error: any) {
      if (error instanceof TimeoutError) {
        this.logger.http({
          type: 'internal-response',
          target: 'org-service',
          statusCode: 504,
          correlationId,
          message: `← [org-service] POST /internal/structure/resolve-by-ids 504: timed out after ${this.timeoutMs}ms`,
        });
        throw new GatewayTimeoutException('org-service did not respond in time');
      }

      const status = error?.response?.status;
      const message: string = error?.response?.data?.message ?? error?.message ?? 'Unknown error';

      this.logger.http({
        type: 'internal-response',
        target: 'org-service',
        statusCode: status ?? 500,
        correlationId,
        message: `← [org-service] POST /internal/structure/resolve-by-ids ${status ?? 500}: ${message}`,
      });

      if (status === 400) {
        throw new BadRequestException(message);
      }

      throw new InternalServerErrorException(
        `Could not validate org structure: ${message}`,
      );
    }
  }
}

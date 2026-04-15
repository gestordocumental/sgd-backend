import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppLogger } from '../logger/app-logger.service';
import { getCorrelationId } from '../correlation/correlation.context';
import { CORRELATION_ID_HEADER } from '../middleware/correlation.middleware';

export interface ResolveStructureItem {
  department: string;
  area?: string;
  position?: string;
}

export interface ResolvedItem {
  index: number;
  departamentoId: string;
  areaId: string | null;
  cargoId: string | null;
}

export interface UnresolvedItem {
  index: number;
  reason: string;
}

export interface ResolveStructureResult {
  resolved: ResolvedItem[];
  unresolved: UnresolvedItem[];
}

export interface ResolveByIdResult {
  departamentoId: string;
  departamentoNombre: string;
  areaId: string | null;
  areaNombre: string | null;
  cargoId: string | null;
  cargoNombre: string | null;
}

@Injectable()
export class OrgClientService {
  private readonly orgServiceUrl: string;
  private readonly internalToken: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.orgServiceUrl  = this.config.getOrThrow<string>('ORG_SERVICE_URL');
    this.internalToken  = this.config.getOrThrow<string>('INTERNAL_TOKEN');
  }

  async resolveStructure(
    orgId: string,
    items: ResolveStructureItem[],
  ): Promise<ResolveStructureResult> {
    const correlationId = getCorrelationId();
    const url = `${this.orgServiceUrl}/internal/structure/resolve`;

    this.logger.http({
      type: 'internal-request',
      target: 'org-service',
      url,
      correlationId,
      message: `→ [org-service] POST /internal/structure/resolve (${items.length} items)`,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post<ResolveStructureResult>(
          url,
          { orgId, items },
          {
            headers: {
              'x-internal-token':    this.internalToken,
              [CORRELATION_ID_HEADER]: correlationId,
            },
          },
        ),
      );

      this.logger.http({
        type: 'internal-response',
        target: 'org-service',
        statusCode: 200,
        correlationId,
        message: `← [org-service] POST /internal/structure/resolve 200`,
      });

      return response.data;
    } catch (error: any) {
      const status  = error?.response?.status;
      const message = error?.response?.data?.message ?? error?.message ?? 'Unknown error';

      this.logger.http({
        type: 'internal-response',
        target: 'org-service',
        statusCode: status ?? 500,
        correlationId,
        message: `← [org-service] POST /internal/structure/resolve ${status ?? 500}: ${message}`,
      });

      throw new InternalServerErrorException(
        `Could not resolve org structure from org-service: ${message}`,
      );
    }
  }

  async resolveStructureById(
    orgId: string,
    departamentoId: string,
    areaId?: string,
    cargoId?: string,
  ): Promise<ResolveByIdResult> {
    const correlationId = getCorrelationId();
    const url = `${this.orgServiceUrl}/internal/structure/resolve-by-ids`;

    this.logger.http({
      type: 'internal-request',
      target: 'org-service',
      url,
      correlationId,
      message: `→ [org-service] POST /internal/structure/resolve-by-ids`,
    });

    try {
      const response = await firstValueFrom(
        this.httpService.post<ResolveByIdResult>(
          url,
          { orgId, departamentoId, areaId, cargoId },
          {
            headers: {
              'x-internal-token':      this.internalToken,
              [CORRELATION_ID_HEADER]: correlationId,
            },
          },
        ),
      );

      this.logger.http({
        type: 'internal-response',
        target: 'org-service',
        statusCode: 200,
        correlationId,
        message: `← [org-service] POST /internal/structure/resolve-by-ids 200`,
      });

      return response.data;
    } catch (error: any) {
      const status  = error?.response?.status;
      const message = error?.response?.data?.message ?? error?.message ?? 'Unknown error';

      this.logger.http({
        type: 'internal-response',
        target: 'org-service',
        statusCode: status ?? 500,
        correlationId,
        message: `← [org-service] POST /internal/structure/resolve-by-ids ${status ?? 500}: ${message}`,
      });

      if (status === 400) {
        throw error.response.data;
      }

      throw new InternalServerErrorException(
        `Could not resolve org structure by IDs from org-service: ${message}`,
      );
    }
  }
}

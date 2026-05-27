import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppLogger } from '../../common/logger/app-logger.service';
import { getCorrelationId } from '../../common/correlation/correlation.context';

interface OrgInfo {
  id: string;
  name: string;
}

@Injectable()
export class OrgClientService {
  private readonly baseUrl: string;
  private readonly internalToken: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.baseUrl       = config.getOrThrow<string>('ORG_SERVICE_URL');
    this.internalToken = config.getOrThrow<string>('INTERNAL_TOKEN');
  }

  async getOrgName(orgId: string): Promise<string | null> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<OrgInfo>(`${this.baseUrl}/api/org/${orgId}`, {
          timeout: 3000,
          headers: {
            'x-internal-token': this.internalToken,
            'x-correlation-id': getCorrelationId(),
          },
        }),
      );
      return data.name ?? null;
    } catch (err: unknown) {
      // Log con detalle suficiente para diagnosticar fallos de conectividad o auth
      const status = (err as { response?: { status?: number } })?.response?.status;
      const detail = (err as { response?: { data?: unknown } })?.response?.data;
      this.logger.warn(
        `Could not fetch org ${orgId} from ${this.baseUrl} — HTTP ${status ?? 'N/A'}: ${err instanceof Error ? err.message : String(err)} | body: ${JSON.stringify(detail ?? null)}`,
        'OrgClientService',
      );
      return null;
    }
  }
}

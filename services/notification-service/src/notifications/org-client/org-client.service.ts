import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout } from 'rxjs';
import { AppLogger, getCorrelationId } from '@sgd/common';
import CircuitBreaker = require('opossum');

interface OrgInfo {
  id: string;
  name: string;
}

@Injectable()
export class OrgClientService {
  private readonly baseUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs = 3_000;
  private readonly cb: CircuitBreaker;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.baseUrl       = config.getOrThrow<string>('ORG_SERVICE_URL');
    this.internalToken = config.getOrThrow<string>('INTERNAL_TOKEN_NOTIF_ORG');

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'org-service',
        timeout:                  false,   // timeout applied per-request via RxJS pipe
        errorThresholdPercentage: 50,
        resetTimeout:             30_000,
        volumeThreshold:          3,
      },
    );
    this.cb.on('open',     () => this.logger.warn('[circuit] org-service OPEN — failing fast', 'OrgClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] org-service HALF-OPEN — probing',  'OrgClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] org-service CLOSED — recovered',   'OrgClientService'));
  }

  async getOrgName(orgId: string): Promise<string | null> {
    if (this.cb.opened) {
      this.logger.warn(`[circuit] org-service circuit open — skipping getOrgName(${orgId})`, 'OrgClientService');
      return null;
    }
    try {
      const result = await this.cb.fire(() =>
        firstValueFrom(
          this.http.get<OrgInfo>(`${this.baseUrl}/api/org/${orgId}`, {
            headers: {
              'x-internal-token': this.internalToken,
              'x-correlation-id': getCorrelationId(),
            },
          }).pipe(timeout(this.timeoutMs)),
        ),
      ) as { data: OrgInfo };
      return result.data.name ?? null;
    } catch (err: any) {
      if (err?.code === 'EOPENBREAKER') {
        this.logger.warn(`[circuit] org-service circuit open — skipping getOrgName(${orgId})`, 'OrgClientService');
        return null;
      }
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

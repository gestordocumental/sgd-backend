import {
  Injectable,
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout, TimeoutError } from 'rxjs';
import { AppLogger, getCorrelationId, CORRELATION_ID_HEADER } from '@sgd/common';

export interface AuditLogEntry {
  id: string;
  service: string;
  actorId: string;
  actorName?: string | null;
  orgId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  resourceName?: string | null;
  correlationId?: string | null;
  ip?: string | null;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

/**
 * Reads a workflow's audit trail from audit-service via its internal
 * (InternalGuard-protected) endpoint — bypassing the user-facing AUDIT:READ
 * permission. This is deliberately a plain HTTP call with no circuit breaker:
 * unlike DocumentClientService (called on the hot path of every workflow
 * create/validate), this only fires once per "Descargar todo" click, so a
 * breaker's stampede protection buys little. Errors are left to propagate —
 * the frontend fetches the ZIP and the audit log as two independent calls,
 * so a failure here must not silently look like "no audit events".
 */
@Injectable()
export class AuditClientService {
  private readonly auditServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.auditServiceUrl = this.config.getOrThrow<string>('AUDIT_SERVICE_URL');
    this.internalToken   = this.config.getOrThrow<string>('INTERNAL_TOKEN_WORKFLOW_AUDIT');
    const raw            = this.config.get<string | number>('AUDIT_SERVICE_TIMEOUT_MS');
    const parsed          = raw == null ? 5_000 : Number(raw);
    this.timeoutMs        = Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000;
  }

  /**
   * Endpoint required in audit-service:
   *   GET /internal/audit/logs-by-correlation?correlationId=&orgId=
   */
  async getLogsByCorrelation(orgId: string, correlationId: string): Promise<AuditLogEntry[]> {
    const reqCorrelationId = getCorrelationId();
    const url =
      `${this.auditServiceUrl}/internal/audit/logs-by-correlation` +
      `?correlationId=${encodeURIComponent(correlationId)}&orgId=${encodeURIComponent(orgId)}`;

    this.logger.http({
      type: 'internal-request',
      target: 'audit-service',
      url,
      correlationId: reqCorrelationId,
      message: `→ [audit-service] GET /internal/audit/logs-by-correlation`,
    });

    try {
      const response = await firstValueFrom(
        this.httpService
          .get<AuditLogEntry[]>(url, {
            headers: {
              'x-internal-token':      this.internalToken,
              [CORRELATION_ID_HEADER]: reqCorrelationId,
            },
          })
          .pipe(timeout(this.timeoutMs)),
      );

      this.logger.http({
        type: 'internal-response',
        target: 'audit-service',
        statusCode: 200,
        correlationId: reqCorrelationId,
        message: `← [audit-service] GET /internal/audit/logs-by-correlation 200`,
      });

      return response.data;
    } catch (error: unknown) {
      return this.handleError(error, url, reqCorrelationId);
    }
  }

  private handleError(error: unknown, url: string, correlationId: string): never {
    if (error instanceof TimeoutError) {
      this.logger.http({
        type: 'internal-response',
        target: 'audit-service',
        statusCode: 504,
        correlationId,
        message: `← [audit-service] ${url} 504: timed out after ${this.timeoutMs}ms`,
      });
      throw new GatewayTimeoutException('audit-service did not respond in time');
    }

    const err     = error as { response?: { status?: number; data?: { message?: string } }; message?: string };
    const status  = err?.response?.status;
    const message = err?.response?.data?.message ?? err?.message ?? 'Unknown error';

    this.logger.http({
      type: 'internal-response',
      target: 'audit-service',
      statusCode: status ?? 500,
      correlationId,
      message: `← [audit-service] ${url} ${status ?? 500}: ${message}`,
    });

    if (status === 400) throw new BadRequestException(message);
    throw new ServiceUnavailableException('audit-service is temporarily unavailable');
  }
}

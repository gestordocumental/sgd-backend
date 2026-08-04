import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom, timeout } from 'rxjs';
import { AppLogger, getCorrelationId, CORRELATION_ID_HEADER } from '@sgd/common';
import CircuitBreaker = require('opossum');

export interface ReviewCycleEnabledResult {
  id: string;
  reviewCycleEnabled: boolean;
}

@Injectable()
export class OrgClientService {
  private readonly orgServiceUrl: string;
  private readonly internalToken: string;
  private readonly timeoutMs: number;
  private readonly cb: CircuitBreaker;

  constructor(
    private readonly httpService: HttpService,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.orgServiceUrl  = this.config.getOrThrow<string>('ORG_SERVICE_URL');
    this.internalToken  = this.config.getOrThrow<string>('INTERNAL_TOKEN_WORKFLOW_ORG');
    const raw           = this.config.get<string | number>('ORG_SERVICE_TIMEOUT_MS');
    const parsed        = raw == null ? 5_000 : Number(raw);
    this.timeoutMs      = Number.isFinite(parsed) && parsed > 0 ? parsed : 5_000;

    this.cb = new CircuitBreaker(
      (fn: () => Promise<unknown>) => fn(),
      {
        name:                     'org-service',
        timeout:                  false,   // RxJS timeout() handles per-request timeouts
        errorThresholdPercentage: 75,
        resetTimeout:             10_000,
        volumeThreshold:          10,
      },
    );
    this.cb.on('open',     () => this.logger.warn('[circuit] org-service OPEN — failing fast', 'OrgClientService'));
    this.cb.on('halfOpen', () => this.logger.log('[circuit] org-service HALF-OPEN — probing', 'OrgClientService'));
    this.cb.on('close',    () => this.logger.log('[circuit] org-service CLOSED — recovered', 'OrgClientService'));
  }

  /**
   * Whether workflows in this org should go through the admin review cycle
   * step. Best-effort: if org-service can't be reached, defaults to `true`
   * (today's behavior for every org) rather than throwing — an org-service
   * outage must not block the approval flow, and failing open here only
   * means the review cycle step still runs, never that it gets bypassed.
   *
   * Endpoint required in org-service:
   *   GET /internal/orgs/:id/review-cycle-enabled
   */
  async isReviewCycleEnabled(orgId: string): Promise<boolean> {
    const correlationId = getCorrelationId();
    const url = `${this.orgServiceUrl}/internal/orgs/${orgId}/review-cycle-enabled`;

    try {
      // Validation lives inside the function handed to fireWithCb (not after
      // it resolves) so a malformed 200 counts as a failure for the circuit
      // breaker too — otherwise org-service could return garbage on every
      // call and the breaker would never see it as unhealthy.
      return await this.fireWithCb<boolean>(async () => {
        const response = await firstValueFrom(
          this.httpService
            .get<ReviewCycleEnabledResult>(url, {
              headers: {
                'x-internal-token':      this.internalToken,
                [CORRELATION_ID_HEADER]: correlationId,
              },
            })
            .pipe(timeout(this.timeoutMs)),
        );
        const reviewCycleEnabled = response.data?.reviewCycleEnabled;
        // A malformed/missing field must not be treated as `false` (silently
        // disables the review cycle) — throwing routes it through the same
        // fail-open catch below as any other bad response.
        if (typeof reviewCycleEnabled !== 'boolean') {
          throw new Error('Invalid reviewCycleEnabled response from org-service');
        }
        return reviewCycleEnabled;
      });
    } catch (error: unknown) {
      this.logger.warn(
        `Could not resolve reviewCycleEnabled for org ${orgId}, defaulting to true: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'OrgClientService',
      );
      return true;
    }
  }

  private async fireWithCb<T>(fn: () => Promise<T>): Promise<T> {
    return this.cb.fire(fn) as Promise<T>;
  }
}

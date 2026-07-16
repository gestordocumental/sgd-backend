import {
  BadRequestException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError, TimeoutError } from 'rxjs';
import { AxiosResponse } from 'axios';
import { AuditClientService, AuditLogEntry } from './audit-client.service';
import { AppLogger, CORRELATION_ID_HEADER } from '@sgd/common';

describe('AuditClientService', () => {
  const auditServiceUrl = 'http://audit-service';
  const internalToken = 'internal-token';
  let httpService: jest.Mocked<Pick<HttpService, 'get'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'http'>>;
  let service: AuditClientService;

  beforeEach(() => {
    httpService = { get: jest.fn() };
    logger = { http: jest.fn() };

    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'AUDIT_SERVICE_URL') return auditServiceUrl;
        if (key === 'INTERNAL_TOKEN_WORKFLOW_AUDIT') return internalToken;
        throw new Error(`Unknown key: ${key}`);
      }),
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService;

    service = new AuditClientService(
      httpService as unknown as HttpService,
      config,
      logger as unknown as AppLogger,
    );
  });

  it('fetches logs by correlation with internal headers', async () => {
    const logs: AuditLogEntry[] = [
      {
        id: 'log-1',
        service: 'workflow-service',
        actorId: 'user-1',
        orgId: 'org-1',
        action: 'WORKFLOW_CREATED',
        resourceType: 'workflow',
        resourceId: 'wf-1',
        metadata: null,
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];
    httpService.get.mockReturnValue(of({ data: logs } as AxiosResponse<AuditLogEntry[]>));

    await expect(service.getLogsByCorrelation('org 1', 'wf-1')).resolves.toBe(logs);

    expect(httpService.get).toHaveBeenCalledWith(
      `${auditServiceUrl}/internal/audit/logs-by-correlation?correlationId=wf-1&orgId=org%201`,
      {
        headers: {
          'x-internal-token': internalToken,
          [CORRELATION_ID_HEADER]: 'no-correlation-id',
        },
      },
    );
    expect(logger.http).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'internal-response', statusCode: 200 }),
    );
  });

  it('maps 400 responses to BadRequestException', async () => {
    httpService.get.mockReturnValue(
      throwError(() => ({ response: { status: 400, data: { message: 'Missing correlationId' } } })),
    );

    await expect(service.getLogsByCorrelation('org-1', 'wf-1')).rejects.toThrow(BadRequestException);
  });

  it('maps timeout errors to GatewayTimeoutException', async () => {
    httpService.get.mockReturnValue(throwError(() => new TimeoutError()));

    await expect(service.getLogsByCorrelation('org-1', 'wf-1')).rejects.toThrow(
      GatewayTimeoutException,
    );
  });

  it('maps unknown/network errors to ServiceUnavailableException — the frontend surfaces this as a soft-fail toast, not a fatal error for the whole download', async () => {
    httpService.get.mockReturnValue(throwError(() => new Error('network down')));

    await expect(service.getLogsByCorrelation('org-1', 'wf-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

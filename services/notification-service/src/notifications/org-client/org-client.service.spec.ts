import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '@sgd/common';
import { of, throwError } from 'rxjs';
import { OrgClientService } from './org-client.service';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-corr-id'),
}));

function makeConfig(): jest.Mocked<ConfigService> {
  return {
    getOrThrow: jest.fn().mockImplementation((key: string) => {
      if (key === 'ORG_SERVICE_URL') return 'http://org-svc';
      if (key === 'INTERNAL_TOKEN_NOTIF_ORG') return 'org-token';
      throw new Error(`Unknown key: ${key}`);
    }),
  } as any;
}

function makeLogger(): jest.Mocked<AppLogger> {
  return { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), http: jest.fn() } as any;
}

describe('OrgClientService', () => {
  it('returns org name on success', async () => {
    const http = {
      get: jest.fn().mockReturnValue(of({ data: { id: 'org-1', name: 'Acme' } })),
    } as unknown as jest.Mocked<HttpService>;
    const service = new OrgClientService(http, makeConfig(), makeLogger());

    await expect(service.getOrgName('org-1')).resolves.toBe('Acme');
    expect(http.get).toHaveBeenCalledWith(
      'http://org-svc/api/org/org-1',
      expect.objectContaining({
        timeout: 3000,
        headers: expect.objectContaining({
          'x-internal-token': 'org-token',
          'x-correlation-id': 'test-corr-id',
        }),
      }),
    );
  });

  it('returns null when org response has no name', async () => {
    const http = {
      get: jest.fn().mockReturnValue(of({ data: { id: 'org-1' } })),
    } as unknown as jest.Mocked<HttpService>;
    const service = new OrgClientService(http, makeConfig(), makeLogger());

    await expect(service.getOrgName('org-1')).resolves.toBeNull();
  });

  it('logs warning and returns null on HTTP error', async () => {
    const logger = makeLogger();
    const http = {
      get: jest.fn().mockReturnValue(
        throwError(() => ({
          response: { status: 404, data: { message: 'not found' } },
          message: 'Request failed',
        })),
      ),
    } as unknown as jest.Mocked<HttpService>;
    const service = new OrgClientService(http, makeConfig(), logger);

    await expect(service.getOrgName('org-1')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('HTTP 404'),
      'OrgClientService',
    );
  });

  it('logs non-Error throws as string', async () => {
    const logger = makeLogger();
    const http = {
      get: jest.fn().mockReturnValue(throwError(() => 'boom')),
    } as unknown as jest.Mocked<HttpService>;
    const service = new OrgClientService(http, makeConfig(), logger);

    await expect(service.getOrgName('org-1')).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('boom'),
      'OrgClientService',
    );
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import {
  GatewayTimeoutException,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { of, throwError, TimeoutError } from 'rxjs';
import { UserClientService } from './user-client.service';

describe('UserClientService', () => {
  let service: UserClientService;
  let httpService: { delete: jest.Mock };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, 'log').mockReturnValue(undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    httpService = { delete: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserClientService,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) =>
              (
                {
                  USER_SERVICE_URL:        'http://localhost:3001',
                  INTERNAL_TOKEN_ORG_USER: 'test-token',
                } as Record<string, string>
              )[key] ?? (() => { throw new Error(`Missing config key: ${key}`); })(),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(UserClientService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('calls the user-service DELETE endpoint with the correct URL and token', async () => {
    httpService.delete.mockReturnValue(of({ status: 200, data: {} }));

    await expect(service.revokeOrgAccess('org-1')).resolves.toBeUndefined();

    expect(httpService.delete).toHaveBeenCalledWith(
      'http://localhost:3001/api/v1/users/internal/orgs/org-1/users',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-internal-token': 'test-token' }),
      }),
    );
  });

  it('resolves without error when user-service returns 404 (already revoked — idempotent)', async () => {
    httpService.delete.mockReturnValue(throwError(() => ({ response: { status: 404 } })));

    // 404 is treated as success and is not retried
    await expect(service.revokeOrgAccess('org-1')).resolves.toBeUndefined();
    expect(httpService.delete).toHaveBeenCalledTimes(1);
  });

  it('throws GatewayTimeoutException on timeout without retrying', async () => {
    httpService.delete.mockReturnValue(throwError(() => new TimeoutError()));

    // Timeouts are not retried — deterministic slow service
    await expect(service.revokeOrgAccess('org-1')).rejects.toBeInstanceOf(GatewayTimeoutException);
    expect(httpService.delete).toHaveBeenCalledTimes(1);
  });

  it('throws ServiceUnavailableException when the circuit breaker is open', async () => {
    const openError = Object.assign(new Error('circuit open'), { code: 'EOPENBREAKER' });
    jest.spyOn((service as any).cb, 'fire').mockRejectedValueOnce(openError);

    await expect(service.revokeOrgAccess('org-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  // ── Retry behavior ────────────────────────────────────────────────────────────
  // sleep() is spied on so retries complete synchronously without fake timers.

  it('retries on 5xx and throws InternalServerErrorException after exhausting all retries', async () => {
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    httpService.delete.mockReturnValue(throwError(() => ({ response: { status: 500 } })));

    await expect(service.revokeOrgAccess('org-1')).rejects.toBeInstanceOf(InternalServerErrorException);
    // Initial attempt + 2 retries = 3 total calls
    expect(httpService.delete).toHaveBeenCalledTimes(3);
    // Backoff: 500ms, then 1000ms
    expect((service as any).sleep).toHaveBeenCalledTimes(2);
    expect((service as any).sleep).toHaveBeenNthCalledWith(1, 500);
    expect((service as any).sleep).toHaveBeenNthCalledWith(2, 1000);
  });

  it('retries on network error and throws InternalServerErrorException after exhausting all retries', async () => {
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    httpService.delete.mockReturnValue(throwError(() => new Error('network error')));

    await expect(service.revokeOrgAccess('org-1')).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(httpService.delete).toHaveBeenCalledTimes(3);
    expect((service as any).sleep).toHaveBeenCalledTimes(2);
  });

  it('succeeds on the second attempt when the first call returns a transient 5xx', async () => {
    jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);
    httpService.delete
      .mockReturnValueOnce(throwError(() => ({ response: { status: 503 } })))
      .mockReturnValue(of({ status: 200, data: {} }));

    await expect(service.revokeOrgAccess('org-1')).resolves.toBeUndefined();
    expect(httpService.delete).toHaveBeenCalledTimes(2);
    // Only one retry delay (500ms for the first attempt)
    expect((service as any).sleep).toHaveBeenCalledTimes(1);
    expect((service as any).sleep).toHaveBeenCalledWith(500);
  });
});

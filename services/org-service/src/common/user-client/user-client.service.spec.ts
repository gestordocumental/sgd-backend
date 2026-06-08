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

  afterEach(() => jest.clearAllMocks());

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

    await expect(service.revokeOrgAccess('org-1')).resolves.toBeUndefined();
  });

  it('throws GatewayTimeoutException when the request exceeds the timeout', async () => {
    httpService.delete.mockReturnValue(throwError(() => new TimeoutError()));

    await expect(service.revokeOrgAccess('org-1')).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('throws InternalServerErrorException on unexpected 5xx errors', async () => {
    httpService.delete.mockReturnValue(throwError(() => ({ response: { status: 500 } })));

    await expect(service.revokeOrgAccess('org-1')).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('throws InternalServerErrorException when the error has no HTTP status', async () => {
    httpService.delete.mockReturnValue(throwError(() => new Error('network error')));

    await expect(service.revokeOrgAccess('org-1')).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('throws ServiceUnavailableException when the circuit breaker is open', async () => {
    const openError = Object.assign(new Error('circuit open'), { code: 'EOPENBREAKER' });
    jest.spyOn((service as any).cb, 'fire').mockRejectedValueOnce(openError);

    await expect(service.revokeOrgAccess('org-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

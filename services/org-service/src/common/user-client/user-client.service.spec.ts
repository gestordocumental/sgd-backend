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
import { UserClientService, isNonTrippingClientError } from './user-client.service';

describe('isNonTrippingClientError', () => {
  it.each([400, 403, 404, 409, 422])(
    'returns true for deterministic client error %i — must not trip the circuit',
    (status) => {
      expect(isNonTrippingClientError(status)).toBe(true);
    },
  );

  it.each([408, 429])(
    'returns false for %i — signals user-service is struggling, must trip the circuit',
    (status) => {
      expect(isNonTrippingClientError(status)).toBe(false);
    },
  );

  it.each([500, 502, 503, 504])('returns false for server error %i', (status) => {
    expect(isNonTrippingClientError(status)).toBe(false);
  });

  it.each([undefined, null, 'not-a-number', 399, 600])(
    'returns false for a non-4xx or non-numeric status (%p)',
    (status) => {
      expect(isNonTrippingClientError(status)).toBe(false);
    },
  );
});

describe('UserClientService', () => {
  let service: UserClientService;
  let httpService: { delete: jest.Mock; get: jest.Mock };

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, 'warn').mockReturnValue(undefined);
    jest.spyOn(Logger.prototype, 'log').mockReturnValue(undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(async () => {
    httpService = { delete: jest.fn(), get: jest.fn() };

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

  // ── getActiveUserIds ──────────────────────────────────────────────────────

  describe('getActiveUserIds', () => {
    it('calls the user-service GET endpoint with the correct URL and token, returning userIds', async () => {
      httpService.get.mockReturnValue(of({ status: 200, data: { userIds: ['u1', 'u2'] } }));

      await expect(service.getActiveUserIds('org-1')).resolves.toEqual(['u1', 'u2']);

      expect(httpService.get).toHaveBeenCalledWith(
        'http://localhost:3001/api/v1/users/internal/orgs/org-1/user-ids',
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-internal-token': 'test-token' }),
        }),
      );
    });

    it('propagates errors from the circuit breaker to the caller', async () => {
      httpService.get.mockReturnValue(throwError(() => ({ response: { status: 500 } })));

      await expect(service.getActiveUserIds('org-1')).rejects.toBeDefined();
    });
  });

  // ── countOrgStructureReferences ────────────────────────────────────────────

  describe('countOrgStructureReferences', () => {
    it('calls the user-service GET endpoint with the correct URL, query params, and token', async () => {
      httpService.get.mockReturnValue(of({ status: 200, data: { count: 2 } }));

      await expect(
        service.countOrgStructureReferences('org-1', { cargoId: 'cargo-1' }),
      ).resolves.toBe(2);

      expect(httpService.get).toHaveBeenCalledWith(
        'http://localhost:3001/internal/users/org-structure-references?orgId=org-1&cargoId=cargo-1',
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-internal-token': 'test-token' }),
        }),
      );
    });

    it('builds the query string for an areaId filter', async () => {
      httpService.get.mockReturnValue(of({ status: 200, data: { count: 0 } }));

      await service.countOrgStructureReferences('org-1', { areaId: 'area-1' });

      expect(httpService.get).toHaveBeenCalledWith(
        'http://localhost:3001/internal/users/org-structure-references?orgId=org-1&areaId=area-1',
        expect.anything(),
      );
    });

    it('builds the query string for a departamentoId filter', async () => {
      httpService.get.mockReturnValue(of({ status: 200, data: { count: 0 } }));

      await service.countOrgStructureReferences('org-1', { departamentoId: 'dept-1' });

      expect(httpService.get).toHaveBeenCalledWith(
        'http://localhost:3001/internal/users/org-structure-references?orgId=org-1&departamentoId=dept-1',
        expect.anything(),
      );
    });

    it('throws GatewayTimeoutException on timeout', async () => {
      httpService.get.mockReturnValue(throwError(() => new TimeoutError()));

      await expect(
        service.countOrgStructureReferences('org-1', { cargoId: 'cargo-1' }),
      ).rejects.toBeInstanceOf(GatewayTimeoutException);
    });

    it('throws ServiceUnavailableException when the circuit breaker is open', async () => {
      const openError = Object.assign(new Error('circuit open'), { code: 'EOPENBREAKER' });
      jest.spyOn((service as any).cb, 'fire').mockRejectedValueOnce(openError);

      await expect(
        service.countOrgStructureReferences('org-1', { cargoId: 'cargo-1' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('passes through a 4xx status/message from user-service', async () => {
      httpService.get.mockReturnValue(
        throwError(() => ({ response: { status: 400, data: { message: 'Bad request' } } })),
      );

      await expect(
        service.countOrgStructureReferences('org-1', { cargoId: 'cargo-1' }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('throws InternalServerErrorException for an unexpected 5xx/network error', async () => {
      httpService.get.mockReturnValue(throwError(() => ({ response: { status: 500 } })));

      await expect(
        service.countOrgStructureReferences('org-1', { cargoId: 'cargo-1' }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });

    // Regression: a 200 response with a missing/non-numeric `count` used to
    // be returned as `undefined` — every caller does `count > 0`, and
    // `undefined > 0` is false, so a malformed response silently let a
    // structure delete through as if zero references existed.
    it.each([
      ['a body with no count field', {}],
      ['a non-numeric count', { count: 'three' }],
      ['a null count', { count: null }],
      ['a NaN count', { count: NaN }],
      ['a negative count', { count: -1 }],
      ['a fractional count', { count: 0.5 }],
    ])('throws InternalServerErrorException (not undefined) for a 200 with %s', async (_label, data) => {
      httpService.get.mockReturnValue(of({ status: 200, data }));

      await expect(
        service.countOrgStructureReferences('org-1', { cargoId: 'cargo-1' }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    });
  });
});

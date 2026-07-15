import { BadRequestException, GatewayTimeoutException, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of, throwError, TimeoutError } from 'rxjs';
import {
  UserClientService,
  UserExistsResult,
  UsersByPositionResult,
  UserDisplayName,
} from './user-client.service';
import { AppLogger, CORRELATION_ID_HEADER } from '@sgd/common';

// Circuit breaker is mocked as a transparent pass-through by default.
jest.mock('opossum', () => jest.fn());
import CircuitBreaker = require('opossum');

const MockCircuitBreaker = CircuitBreaker as unknown as jest.Mock;
let mockCbInstance: { fire: jest.Mock; on: jest.Mock; opened: boolean };

describe('UserClientService', () => {
  const userServiceUrl = 'http://user-service';
  const internalToken = 'internal-token';
  let httpService: jest.Mocked<Pick<HttpService, 'get' | 'post'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'http' | 'log' | 'warn'>>;
  let service: UserClientService;

  beforeEach(() => {
    mockCbInstance = {
      fire: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
      on: jest.fn(),
      opened: false,
    };
    MockCircuitBreaker.mockImplementation(() => mockCbInstance as any);

    httpService = {
      get: jest.fn(),
      post: jest.fn(),
    };
    logger = {
      http: jest.fn(),
      log: jest.fn(),
      warn: jest.fn(),
    };

    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'USER_SERVICE_URL')           return userServiceUrl;
        if (key === 'INTERNAL_TOKEN_WORKFLOW_USER') return internalToken;
        throw new Error(`Unknown key: ${key}`);
      }),
      get: jest.fn().mockReturnValue(1000),
    } as unknown as ConfigService;

    service = new UserClientService(
      httpService as unknown as HttpService,
      config,
      logger as unknown as AppLogger,
    );
  });

  it('gets users by position with org and filter payload', async () => {
    const result: UsersByPositionResult = {
      users: [{ id: 'user-1', firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.com' }],
    };
    httpService.post.mockReturnValue(of({ data: result } as AxiosResponse<UsersByPositionResult>));

    await expect(
      service.getUsersByPosition('org-1', {
        cargoId: 'cargo-1',
        areaId: 'area-1',
        departamentoId: 'dept-1',
      }),
    ).resolves.toBe(result);

    expect(httpService.post).toHaveBeenCalledWith(
      `${userServiceUrl}/internal/users/by-position`,
      {
        orgId: 'org-1',
        cargoId: 'cargo-1',
        areaId: 'area-1',
        departamentoId: 'dept-1',
      },
      {
        headers: {
          'x-internal-token': internalToken,
          [CORRELATION_ID_HEADER]: 'no-correlation-id',
        },
      },
    );
    expect(logger.http).toHaveBeenCalledWith(expect.objectContaining({ type: 'internal-response', statusCode: 200 }));
  });

  it('validates that a user exists', async () => {
    const result: UserExistsResult = { exists: true, isActive: true };
    httpService.get.mockReturnValue(of({ data: result } as AxiosResponse<UserExistsResult>));

    await expect(service.validateUserExists('user-1')).resolves.toBe(result);

    expect(httpService.get).toHaveBeenCalledWith(
      `${userServiceUrl}/internal/users/user-1/exists`,
      {
        headers: {
          'x-internal-token': internalToken,
          [CORRELATION_ID_HEADER]: 'no-correlation-id',
        },
      },
    );
  });

  it('maps 400 responses to BadRequestException', async () => {
    httpService.post.mockReturnValue(
      throwError(() => ({ response: { status: 400, data: { message: 'Invalid filters' } } })),
    );

    await expect(service.getUsersByPosition('org-1', {})).rejects.toThrow(BadRequestException);
  });

  it('maps 404 responses to NotFoundException without leaking internal service name', async () => {
    httpService.get.mockReturnValue(
      throwError(() => ({ response: { status: 404, data: { message: 'Missing user' } } })),
    );

    const error = await service
      .validateUserExists('missing-user')
      .then(() => null, (e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('Resource not found');
    expect(error.message).not.toContain('user-service');
  });

  it('maps timeout errors to GatewayTimeoutException', async () => {
    httpService.post.mockReturnValue(throwError(() => new TimeoutError()));

    await expect(service.getUsersByPosition('org-1', {})).rejects.toThrow(GatewayTimeoutException);
  });

  it('maps unknown errors to InternalServerErrorException', async () => {
    httpService.get.mockReturnValue(throwError(() => new Error('network down')));

    await expect(service.validateUserExists('user-1')).rejects.toThrow(InternalServerErrorException);
  });

  // ── getUsersByIds (timeline actor-name resolution) ────────────────────────

  describe('getUsersByIds', () => {
    it('returns empty map without calling the http client for an empty ids array', async () => {
      const result = await service.getUsersByIds([]);

      expect(result.size).toBe(0);
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('resolves a map keyed by user id on success, via batch-display-names (no email in the request or response)', async () => {
      // Regression: this must hit batch-display-names, not batch-by-ids —
      // the latter returns email, which this service has no use for and must
      // never receive, since it's shown to any workflow viewer regardless of
      // whether they hold USERS:READ.
      const users: UserDisplayName[] = [
        { id: 'user-1', displayName: 'Ada Lovelace' },
        { id: 'user-2', displayName: 'Bo Diaz' },
      ];
      httpService.post.mockReturnValue(of({ data: users } as AxiosResponse<UserDisplayName[]>));

      const result = await service.getUsersByIds(['user-1', 'user-2']);

      expect(httpService.post).toHaveBeenCalledWith(
        `${userServiceUrl}/internal/users/batch-display-names`,
        { ids: ['user-1', 'user-2'] },
        {
          headers: {
            'x-internal-token': internalToken,
            [CORRELATION_ID_HEADER]: 'no-correlation-id',
          },
        },
      );
      expect(result.get('user-1')).toEqual(users[0]);
      expect(result.get('user-2')).toEqual(users[1]);
    });

    it('resolves displayName: null for a user with no first/last name, instead of falling back to email', async () => {
      const users: UserDisplayName[] = [{ id: 'user-1', displayName: null }];
      httpService.post.mockReturnValue(of({ data: users } as AxiosResponse<UserDisplayName[]>));

      const result = await service.getUsersByIds(['user-1']);

      expect(result.get('user-1')).toEqual({ id: 'user-1', displayName: null });
    });

    it('splits requests into batches of at most 500 ids and merges the results', async () => {
      // Regression: user-service's batch-display-names endpoint rejects
      // requests over 500 ids outright — a single oversized request used to
      // degrade name resolution to empty for every participant/actor, not
      // just the ones past the limit.
      const userIds = Array.from({ length: 501 }, (_, i) => `user-${i}`);
      httpService.post.mockImplementation((_url: string, data?: unknown) => {
        const body = data as { ids: string[] };
        const users: UserDisplayName[] = body.ids.map((id) => ({ id, displayName: `Name ${id}` }));
        return of({ data: users } as AxiosResponse<UserDisplayName[]>);
      });

      const result = await service.getUsersByIds(userIds);

      expect(httpService.post).toHaveBeenCalledTimes(2);
      expect(httpService.post).toHaveBeenNthCalledWith(
        1,
        `${userServiceUrl}/internal/users/batch-display-names`,
        { ids: userIds.slice(0, 500) },
        expect.anything(),
      );
      expect(httpService.post).toHaveBeenNthCalledWith(
        2,
        `${userServiceUrl}/internal/users/batch-display-names`,
        { ids: userIds.slice(500) },
        expect.anything(),
      );
      expect(result.size).toBe(501);
      expect(result.get('user-0')).toEqual({ id: 'user-0', displayName: 'Name user-0' });
      expect(result.get('user-500')).toEqual({ id: 'user-500', displayName: 'Name user-500' });
    });

    it('keeps names resolved by other batches when one batch fails (per-batch best-effort)', async () => {
      const userIds = Array.from({ length: 501 }, (_, i) => `user-${i}`);
      httpService.post.mockImplementation((_url: string, data?: unknown) => {
        const body = data as { ids: string[] };
        if (body.ids.length === 1) return throwError(() => new Error('batch failed'));
        const users: UserDisplayName[] = body.ids.map((id) => ({ id, displayName: `Name ${id}` }));
        return of({ data: users } as AxiosResponse<UserDisplayName[]>);
      });

      const result = await service.getUsersByIds(userIds);

      expect(result.size).toBe(500); // the failing single-id batch contributed nothing
      expect(result.get('user-0')).toEqual({ id: 'user-0', displayName: 'Name user-0' });
      expect(result.has('user-500')).toBe(false);
    });

    it('returns an empty map instead of throwing when user-service fails (best-effort)', async () => {
      httpService.post.mockReturnValue(throwError(() => new Error('network down')));

      const result = await service.getUsersByIds(['user-1']);

      expect(result.size).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not resolve user names for timeline'),
        'UserClientService',
      );
    });

    it('returns an empty map instead of throwing when the circuit breaker is open', async () => {
      mockCbInstance.fire.mockRejectedValueOnce(
        Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }),
      );

      const result = await service.getUsersByIds(['user-1']);

      expect(result.size).toBe(0);
    });
  });

  // ── circuit breaker ──────────────────────────────────────────────────────

  it('throws ServiceUnavailableException when user-service circuit is open (getUsersByPosition)', async () => {
    mockCbInstance.fire.mockRejectedValueOnce(
      Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }),
    );

    await expect(service.getUsersByPosition('org-1', {})).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException when user-service circuit is open (validateUserExists)', async () => {
    mockCbInstance.fire.mockRejectedValueOnce(
      Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }),
    );

    await expect(service.validateUserExists('user-1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('registers open/halfOpen/close handlers on the circuit breaker', () => {
    expect(mockCbInstance.on).toHaveBeenCalledWith('open', expect.any(Function));
    expect(mockCbInstance.on).toHaveBeenCalledWith('halfOpen', expect.any(Function));
    expect(mockCbInstance.on).toHaveBeenCalledWith('close', expect.any(Function));
  });
});

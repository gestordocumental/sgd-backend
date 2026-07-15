import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of, throwError } from 'rxjs';
import { UserClientService, UserDisplayName } from './user-client.service';
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
        if (key === 'USER_SERVICE_URL') return userServiceUrl;
        if (key === 'INTERNAL_TOKEN_AUDIT_USER') return internalToken;
        throw new Error(`Unknown key: ${key}`);
      }),
      get: jest.fn(),
    } as unknown as ConfigService;

    service = new UserClientService(
      httpService as unknown as HttpService,
      config,
      logger as unknown as AppLogger,
    );
  });

  it('registers open/halfOpen/close handlers on the circuit breaker', () => {
    expect(mockCbInstance.on).toHaveBeenCalledWith('open', expect.any(Function));
    expect(mockCbInstance.on).toHaveBeenCalledWith('halfOpen', expect.any(Function));
    expect(mockCbInstance.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  describe('getUsersByIds', () => {
    it('returns empty map without calling the http client for an empty ids array', async () => {
      const result = await service.getUsersByIds([]);

      expect(result.size).toBe(0);
      expect(httpService.post).not.toHaveBeenCalled();
    });

    it('resolves a map keyed by user id on success, via batch-display-names (no email in the request or response)', async () => {
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
      const userIds = Array.from({ length: 501 }, (_, i) => `user-${i}`);
      httpService.post.mockImplementation((_url: string, data?: unknown) => {
        const body = data as { ids: string[] };
        const users: UserDisplayName[] = body.ids.map((id) => ({ id, displayName: `Name ${id}` }));
        return of({ data: users } as AxiosResponse<UserDisplayName[]>);
      });

      const result = await service.getUsersByIds(userIds);

      expect(httpService.post).toHaveBeenCalledTimes(2);
      expect(result.size).toBe(501);
      expect(result.get('user-0')).toEqual({ id: 'user-0', displayName: 'Name user-0' });
      expect(result.get('user-500')).toEqual({ id: 'user-500', displayName: 'Name user-500' });
    });

    it('returns an empty map instead of throwing when user-service fails (best-effort)', async () => {
      httpService.post.mockReturnValue(throwError(() => new Error('network down')));

      const result = await service.getUsersByIds(['user-1']);

      expect(result.size).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not resolve actor names'),
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
});

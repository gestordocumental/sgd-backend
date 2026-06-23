import { UserClientService } from './user-client.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '@sgd/common';
import { of, throwError } from 'rxjs';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-corr-id'),
}));

// Circuit breaker is mocked as a transparent pass-through by default.
jest.mock('opossum', () => jest.fn());
import CircuitBreaker = require('opossum');

const MockCircuitBreaker = CircuitBreaker as unknown as jest.Mock;
let mockCbInstance: { fire: jest.Mock; on: jest.Mock; opened: boolean };

function makeConfig(url = 'http://user-svc', token = 'int-token'): jest.Mocked<ConfigService> {
  return {
    getOrThrow: jest.fn().mockImplementation((key: string) => {
      if (key === 'USER_SERVICE_URL')          return url;
      if (key === 'INTERNAL_TOKEN_NOTIF_USER') return token;
      throw new Error(`Unknown key: ${key}`);
    }),
  } as any;
}

function makeHttp(response?: any, error?: any): jest.Mocked<HttpService> {
  return {
    get: error
      ? jest.fn().mockReturnValue(throwError(() => error))
      : jest.fn().mockReturnValue(of({ data: response })),
    post: error
      ? jest.fn().mockReturnValue(throwError(() => error))
      : jest.fn().mockReturnValue(of({ data: [response] })),
  } as any;
}

function makeLogger(): jest.Mocked<AppLogger> {
  return { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), http: jest.fn() } as any;
}

const userInfo = { id: 'user-1', email: 'user@test.com', fullName: 'Test User' };

describe('UserClientService (notification-service)', () => {
  beforeEach(() => {
    mockCbInstance = {
      fire: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
      on: jest.fn(),
      opened: false,
    };
    MockCircuitBreaker.mockImplementation(() => mockCbInstance as any);
  });

  it('getUserById() returns user info on success', async () => {
    const http = {
      get: jest.fn().mockReturnValue(of({ data: userInfo })),
    } as any;
    const svc = new UserClientService(http, makeConfig(), makeLogger());
    const result = await svc.getUserById('user-1');
    expect(result).toEqual(userInfo);
  });

  it('getUserById() returns null and logs warning on HTTP error', async () => {
    const logger = makeLogger();
    const svc    = new UserClientService(makeHttp(undefined, new Error('timeout')), makeConfig(), logger);
    const result = await svc.getUserById('user-1');
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('timeout'), 'UserClientService');
  });

  it('getUserById() logs non-Error throws as string', async () => {
    const logger = makeLogger();
    const svc    = new UserClientService(makeHttp(undefined, 'string-error'), makeConfig(), logger);
    const result = await svc.getUserById('user-1');
    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('string-error'), 'UserClientService');
  });

  it('getUserById() returns null immediately when circuit is open', async () => {
    mockCbInstance.opened = true;
    const logger = makeLogger();
    const http = { get: jest.fn() } as any;
    const svc = new UserClientService(http, makeConfig(), logger);
    const result = await svc.getUserById('user-1');
    expect(result).toBeNull();
    expect(http.get).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('circuit open'), 'UserClientService');
  });

  it('getUserById() returns null when circuit breaker rejects with EOPENBREAKER', async () => {
    mockCbInstance.fire.mockRejectedValueOnce({ code: 'EOPENBREAKER' });
    const logger = makeLogger();
    const http = { get: jest.fn() } as any;
    const svc = new UserClientService(http, makeConfig(), logger);

    const result = await svc.getUserById('user-1');

    expect(result).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('circuit open'), 'UserClientService');
  });

  it('getUsersByIds() returns a map of found users', async () => {
    const http = {
      post: jest.fn().mockReturnValue(of({ data: [userInfo, userInfo] })),
    } as any;
    const svc = new UserClientService(http, makeConfig(), makeLogger());
    const map = await svc.getUsersByIds(['user-1', 'user-2']);
    expect(map.size).toBe(1); // same id deduped by map
  });

  it('getUsersByIds() returns empty map for empty input', async () => {
    const svc = new UserClientService(makeHttp(userInfo), makeConfig(), makeLogger());
    const map = await svc.getUsersByIds([]);
    expect(map.size).toBe(0);
  });

  it('getUsersByIds() returns empty map when circuit is open', async () => {
    mockCbInstance.opened = true;
    const logger = makeLogger();
    const http = { post: jest.fn() } as any;
    const svc = new UserClientService(http, makeConfig(), logger);
    const map = await svc.getUsersByIds(['user-1']);
    expect(map.size).toBe(0);
    expect(http.post).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('circuit open'), 'UserClientService');
  });

  it('getUsersByIds() returns empty map when circuit breaker rejects with EOPENBREAKER', async () => {
    mockCbInstance.fire.mockRejectedValueOnce({ code: 'EOPENBREAKER' });
    const logger = makeLogger();
    const http = { post: jest.fn() } as any;
    const svc = new UserClientService(http, makeConfig(), logger);

    const map = await svc.getUsersByIds(['user-1']);

    expect(map.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('circuit open'), 'UserClientService');
  });

  it('getUsersByIds() falls back to individual calls when batch request fails', async () => {
    const logger = makeLogger();
    const http = {
      post: jest.fn().mockReturnValue(throwError(() => new Error('batch timeout'))),
      get: jest.fn()
        .mockReturnValueOnce(of({ data: { ...userInfo, id: 'user-1' } }))
        .mockReturnValueOnce(of({ data: { ...userInfo, id: 'user-2' } })),
    } as any;
    const svc = new UserClientService(http, makeConfig(), logger);

    const map = await svc.getUsersByIds(['user-1', 'user-2']);

    expect(map.size).toBe(2);
    expect(map.get('user-1')?.id).toBe('user-1');
    expect(map.get('user-2')?.id).toBe('user-2');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('falling back to individual calls'),
      'UserClientService',
    );
  });

  it('registers open/halfOpen/close handlers on the circuit breaker', () => {
    new UserClientService(makeHttp(userInfo), makeConfig(), makeLogger());
    expect(mockCbInstance.on).toHaveBeenCalledWith('open', expect.any(Function));
    expect(mockCbInstance.on).toHaveBeenCalledWith('halfOpen', expect.any(Function));
    expect(mockCbInstance.on).toHaveBeenCalledWith('close', expect.any(Function));
  });
});

import { UserClientService } from './user-client.service';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AppLogger } from '../../common/logger/app-logger.service';
import { of, throwError } from 'rxjs';

jest.mock('../../common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-corr-id'),
}));

function makeConfig(url = 'http://user-svc', token = 'int-token'): jest.Mocked<ConfigService> {
  return {
    getOrThrow: jest.fn().mockImplementation((key: string) => {
      if (key === 'USER_SERVICE_URL') return url;
      if (key === 'INTERNAL_TOKEN')   return token;
      throw new Error(`Unknown key: ${key}`);
    }),
  } as any;
}

function makeHttp(response?: any, error?: any): jest.Mocked<HttpService> {
  return {
    get: error
      ? jest.fn().mockReturnValue(throwError(() => error))
      : jest.fn().mockReturnValue(of({ data: response })),
  } as any;
}

function makeLogger(): jest.Mocked<AppLogger> {
  return { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), http: jest.fn() } as any;
}

const userInfo = { id: 'user-1', email: 'user@test.com', fullName: 'Test User' };

describe('UserClientService', () => {
  it('getUserById() returns user info on success', async () => {
    const svc = new UserClientService(makeHttp(userInfo), makeConfig(), makeLogger());
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

  it('getUsersByIds() returns a map of found users', async () => {
    const svc = new UserClientService(makeHttp(userInfo), makeConfig(), makeLogger());
    const map = await svc.getUsersByIds(['user-1', 'user-2']);
    expect(map.get('user-1')).toEqual(userInfo);
    expect(map.get('user-2')).toEqual(userInfo);
  });

  it('getUsersByIds() omits null results from map', async () => {
    const logger = makeLogger();
    const svc    = new UserClientService(makeHttp(undefined, new Error('not found')), makeConfig(), logger);
    const map    = await svc.getUsersByIds(['user-1']);
    expect(map.size).toBe(0);
  });

  it('getUsersByIds() returns empty map for empty input', async () => {
    const svc = new UserClientService(makeHttp(userInfo), makeConfig(), makeLogger());
    const map = await svc.getUsersByIds([]);
    expect(map.size).toBe(0);
  });
});

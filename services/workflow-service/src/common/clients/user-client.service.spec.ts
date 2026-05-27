import { BadRequestException, GatewayTimeoutException, InternalServerErrorException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of, throwError, TimeoutError } from 'rxjs';
import {
  UserClientService,
  UserExistsResult,
  UsersByPositionResult,
} from './user-client.service';
import { AppLogger } from '../logger/app-logger.service';
import { CORRELATION_ID_HEADER } from '../middleware/correlation.middleware';

describe('UserClientService', () => {
  const userServiceUrl = 'http://user-service';
  const internalToken = 'internal-token';
  let httpService: jest.Mocked<Pick<HttpService, 'get' | 'post'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'http'>>;
  let service: UserClientService;

  beforeEach(() => {
    httpService = {
      get: jest.fn(),
      post: jest.fn(),
    };
    logger = {
      http: jest.fn(),
    };

    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'USER_SERVICE_URL') return userServiceUrl;
        if (key === 'INTERNAL_TOKEN') return internalToken;
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

  it('maps 404 responses to BadRequestException with resource context', async () => {
    httpService.get.mockReturnValue(
      throwError(() => ({ response: { status: 404, data: { message: 'Missing user' } } })),
    );

    await expect(service.validateUserExists('missing-user')).rejects.toThrow(
      'Resource not found in user-service: Missing user',
    );
  });

  it('maps timeout errors to GatewayTimeoutException', async () => {
    httpService.post.mockReturnValue(throwError(() => new TimeoutError()));

    await expect(service.getUsersByPosition('org-1', {})).rejects.toThrow(GatewayTimeoutException);
  });

  it('maps unknown errors to InternalServerErrorException', async () => {
    httpService.get.mockReturnValue(throwError(() => new Error('network down')));

    await expect(service.validateUserExists('user-1')).rejects.toThrow(InternalServerErrorException);
  });
});

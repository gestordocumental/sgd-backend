import { BadRequestException, GatewayTimeoutException, InternalServerErrorException, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of, throwError, TimeoutError } from 'rxjs';
import {
  UserClientService,
  UserExistsResult,
  UsersByPositionResult,
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

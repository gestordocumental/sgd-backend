import { Test, TestingModule } from '@nestjs/testing';
import { BadGatewayException, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { AuthClientService } from './auth-client.service';
import { AppLogger } from '@sgd/common';

// Mock the correlation context so it does not rely on AsyncLocalStorage state
jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const AUTH_URL = 'http://auth-service:3000';
const INTERNAL_TOKEN = 'test-internal-token';

function makeAxiosError(status: number, message: string) {
  return {
    response: { status, data: { message } },
    message: 'Request failed',
  };
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('AuthClientService', () => {
  let service: AuthClientService;
  let httpService: jest.Mocked<HttpService>;
  let logger: jest.Mocked<AppLogger>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthClientService,
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
            patch: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn((key: string) => {
              if (key === 'AUTH_SERVICE_URL')      return AUTH_URL;
              if (key === 'INTERNAL_TOKEN_USER_AUTH') return INTERNAL_TOKEN;
              throw new Error(`Unknown config key: ${key}`);
            }),
          },
        },
        {
          provide: AppLogger,
          useValue: {
            http: jest.fn(),
            log: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(AuthClientService);
    httpService = module.get(HttpService);
    logger = module.get(AppLogger);
  });

  // ─── provisionCredentials ─────────────────────────────────────────────────

  describe('provisionCredentials', () => {
    const payload = {
      userId: 'user-uuid-1',
      email: 'test@example.com',
      password: 'Str0ng@Pass',
    };

    it('sends POST to auth-service provision endpoint with correct headers', async () => {
      httpService.post.mockReturnValue(of({ status: 201, data: {} } as any));

      await service.provisionCredentials(payload);

      expect(httpService.post).toHaveBeenCalledWith(
        `${AUTH_URL}/api/v1/auth/credentials/provision`,
        payload,
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-internal-token': INTERNAL_TOKEN,
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('logs the outgoing request and incoming response', async () => {
      httpService.post.mockReturnValue(of({ status: 201, data: {} } as any));

      await service.provisionCredentials(payload);

      expect(logger.http).toHaveBeenCalledTimes(2);
    });

    it('throws HttpException for 4xx errors from auth-service', async () => {
      httpService.post.mockReturnValue(
        throwError(() => makeAxiosError(409, 'Credentials already exist')),
      );

      await expect(service.provisionCredentials(payload)).rejects.toThrow(HttpException);

      try {
        await service.provisionCredentials(payload);
      } catch (err: any) {
        expect(err.getStatus()).toBe(409);
        expect(err.message).toBe('Credentials already exist');
      }
    });

    it('throws BadGatewayException for 5xx errors from auth-service', async () => {
      httpService.post.mockReturnValue(
        throwError(() => makeAxiosError(503, 'Service unavailable')),
      );

      await expect(service.provisionCredentials(payload)).rejects.toThrow(BadGatewayException);
    });

    it('throws BadGatewayException when auth-service is unreachable (no response)', async () => {
      httpService.post.mockReturnValue(
        throwError(() => ({ message: 'ECONNREFUSED' })),
      );

      await expect(service.provisionCredentials(payload)).rejects.toThrow(BadGatewayException);
    });
  });

  // ─── disableCredentials ───────────────────────────────────────────────────

  describe('disableCredentials', () => {
    it('sends PATCH to the correct disable endpoint', async () => {
      httpService.patch.mockReturnValue(of({ status: 200, data: {} } as any));

      await service.disableCredentials('user-uuid-1');

      expect(httpService.patch).toHaveBeenCalledWith(
        `${AUTH_URL}/api/v1/auth/credentials/user-uuid-1/disable`,
        {},
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-internal-token': INTERNAL_TOKEN }),
        }),
      );
    });

    it('throws BadGatewayException when auth-service is unavailable', async () => {
      httpService.patch.mockReturnValue(
        throwError(() => makeAxiosError(503, 'Unavailable')),
      );

      await expect(service.disableCredentials('user-uuid-1')).rejects.toThrow(BadGatewayException);
    });

    it('throws HttpException for 4xx responses', async () => {
      httpService.patch.mockReturnValue(
        throwError(() => makeAxiosError(404, 'User not found in auth-service')),
      );

      await expect(service.disableCredentials('user-uuid-1')).rejects.toThrow(HttpException);
    });
  });

  // ─── enableCredentials ────────────────────────────────────────────────────

  describe('enableCredentials', () => {
    it('sends PATCH to the correct enable endpoint', async () => {
      httpService.patch.mockReturnValue(of({ status: 200, data: {} } as any));

      await service.enableCredentials('user-uuid-1');

      expect(httpService.patch).toHaveBeenCalledWith(
        `${AUTH_URL}/api/v1/auth/credentials/user-uuid-1/enable`,
        {},
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-internal-token': INTERNAL_TOKEN }),
        }),
      );
    });

    it('throws BadGatewayException when auth-service is unavailable', async () => {
      httpService.patch.mockReturnValue(
        throwError(() => makeAxiosError(500, 'Internal error')),
      );

      await expect(service.enableCredentials('user-uuid-1')).rejects.toThrow(BadGatewayException);
    });
  });
});

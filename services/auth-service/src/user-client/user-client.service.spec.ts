import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { UserClientService } from './user-client.service';
import { AppLogger } from '../common/logger/app-logger.service';

jest.mock('../common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('test-correlation-id'),
}));

jest.mock('../common/middleware/correlation.middleware', () => ({
  CORRELATION_ID_HEADER: 'x-correlation-id',
}));

describe('UserClientService', () => {
  let service: UserClientService;
  let httpService: { get: jest.Mock };

  beforeEach(async () => {
    httpService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserClientService,
        { provide: HttpService, useValue: httpService },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) =>
              ({
                USER_SERVICE_URL: 'http://user-service',
                INTERNAL_TOKEN: 'test-internal-token',
              }[key]),
            ),
          },
        },
        {
          provide: AppLogger,
          useValue: { http: jest.fn(), log: jest.fn(), error: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(UserClientService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── getUserInfo ───────────────────────────────────────────────────────────

  describe('getUserInfo', () => {
    it('returns isSuperAdmin: true when user is super admin', async () => {
      httpService.get.mockReturnValue(of({ data: { isSuperAdmin: true } }));

      const result = await service.getUserInfo('user-id');

      expect(result).toEqual({ isSuperAdmin: true });
    });

    it('returns isSuperAdmin: false when user is not super admin', async () => {
      httpService.get.mockReturnValue(of({ data: { isSuperAdmin: false } }));

      const result = await service.getUserInfo('user-id');

      expect(result).toEqual({ isSuperAdmin: false });
    });

    it('returns isSuperAdmin: false when field is absent from response', async () => {
      httpService.get.mockReturnValue(of({ data: {} }));

      const result = await service.getUserInfo('user-id');

      expect(result).toEqual({ isSuperAdmin: false });
    });

    it('calls the correct user-service endpoint', async () => {
      httpService.get.mockReturnValue(of({ data: { isSuperAdmin: false } }));

      await service.getUserInfo('abc-123');

      expect(httpService.get).toHaveBeenCalledWith(
        'http://user-service/api/users/abc-123',
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-internal-token': 'test-internal-token' }),
        }),
      );
    });

    it('throws NotFoundException when user-service returns 404', async () => {
      httpService.get.mockReturnValue(
        throwError(() => ({
          response: { status: 404, data: { message: 'User not found' } },
        })),
      );

      await expect(service.getUserInfo('missing-id')).rejects.toThrow(NotFoundException);
    });

    it('throws InternalServerErrorException on 5xx errors', async () => {
      httpService.get.mockReturnValue(
        throwError(() => ({
          response: { status: 503, data: { message: 'Service Unavailable' } },
        })),
      );

      await expect(service.getUserInfo('user-id')).rejects.toThrow(InternalServerErrorException);
    });

    it('throws InternalServerErrorException on network errors (no HTTP response)', async () => {
      httpService.get.mockReturnValue(
        throwError(() => ({ message: 'ECONNREFUSED' })),
      );

      await expect(service.getUserInfo('user-id')).rejects.toThrow(InternalServerErrorException);
    });
  });

  // ── getUserCompanies ──────────────────────────────────────────────────────

  describe('getUserCompanies', () => {
    it('returns array of orgIds', async () => {
      httpService.get.mockReturnValue(of({ data: ['org-1', 'org-2'] }));

      const result = await service.getUserCompanies('user-id');

      expect(result).toEqual(['org-1', 'org-2']);
    });

    it('returns empty array when user has no company memberships', async () => {
      httpService.get.mockReturnValue(of({ data: [] }));

      const result = await service.getUserCompanies('user-id');

      expect(result).toEqual([]);
    });

    it('calls the correct user-service endpoint with internal token', async () => {
      httpService.get.mockReturnValue(of({ data: [] }));

      await service.getUserCompanies('abc-123');

      expect(httpService.get).toHaveBeenCalledWith(
        'http://user-service/api/users/abc-123/companies',
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-internal-token': 'test-internal-token' }),
        }),
      );
    });

    it('throws InternalServerErrorException on HTTP error', async () => {
      httpService.get.mockReturnValue(
        throwError(() => ({
          response: { status: 500, data: { message: 'Internal Server Error' } },
        })),
      );

      await expect(service.getUserCompanies('user-id')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('throws InternalServerErrorException on network failure', async () => {
      httpService.get.mockReturnValue(
        throwError(() => ({ message: 'ETIMEDOUT' })),
      );

      await expect(service.getUserCompanies('user-id')).rejects.toThrow(
        InternalServerErrorException,
      );
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import {
  GatewayTimeoutException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { of, throwError, TimeoutError } from 'rxjs';
import { AppLogger } from '@sgd/common';
import { DocumentClientService, isNonTrippingClientError } from './document-client.service';

describe('isNonTrippingClientError', () => {
  it.each([400, 403, 404, 409, 422])(
    'returns true for deterministic client error %i — must not trip the circuit',
    (status) => {
      expect(isNonTrippingClientError(status)).toBe(true);
    },
  );

  it.each([408, 429])(
    'returns false for %i — signals document-service is struggling, must trip the circuit',
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

describe('DocumentClientService', () => {
  let service: DocumentClientService;
  let httpService: { get: jest.Mock };
  let mockLogger: jest.Mocked<AppLogger>;

  beforeEach(async () => {
    httpService = { get: jest.fn() };
    mockLogger = {
      log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), http: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DocumentClientService,
        { provide: HttpService, useValue: httpService },
        { provide: AppLogger, useValue: mockLogger },
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: jest.fn().mockImplementation((key: string) =>
              (
                {
                  DOCUMENT_SERVICE_URL:    'http://localhost:3003',
                  INTERNAL_TOKEN_ORG_DOC:  'test-token',
                } as Record<string, string>
              )[key] ?? (() => { throw new Error(`Missing config key: ${key}`); })(),
            ),
            get: jest.fn().mockReturnValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get(DocumentClientService);
  });

  afterEach(() => jest.clearAllMocks());

  it('calls the document-service GET endpoint with the correct URL, query params, and token', async () => {
    httpService.get.mockReturnValue(of({ status: 200, data: { count: 3 } }));

    await expect(
      service.countOrgStructureReferences('org-1', { cargoId: 'cargo-1' }),
    ).resolves.toBe(3);

    expect(httpService.get).toHaveBeenCalledWith(
      'http://localhost:3003/internal/typologies/org-structure-references?orgId=org-1&cargoId=cargo-1',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-internal-token': 'test-token' }),
      }),
    );
  });

  it('builds the query string for an areaId filter', async () => {
    httpService.get.mockReturnValue(of({ status: 200, data: { count: 0 } }));

    await service.countOrgStructureReferences('org-1', { areaId: 'area-1' });

    expect(httpService.get).toHaveBeenCalledWith(
      'http://localhost:3003/internal/typologies/org-structure-references?orgId=org-1&areaId=area-1',
      expect.anything(),
    );
  });

  it('builds the query string for a departamentoId filter', async () => {
    httpService.get.mockReturnValue(of({ status: 200, data: { count: 0 } }));

    await service.countOrgStructureReferences('org-1', { departamentoId: 'dept-1' });

    expect(httpService.get).toHaveBeenCalledWith(
      'http://localhost:3003/internal/typologies/org-structure-references?orgId=org-1&departamentoId=dept-1',
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

  it('passes through a 4xx status/message from document-service', async () => {
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
});

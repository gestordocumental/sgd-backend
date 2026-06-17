import { BadRequestException, GatewayTimeoutException, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError, TimeoutError } from 'rxjs';
import { AxiosResponse } from 'axios';
import {
  DocumentClientService,
  TypologyPublicInfo,
  ValidateDocumentResult,
} from './document-client.service';
import { AppLogger, CORRELATION_ID_HEADER } from '@sgd/common';

// Circuit breaker is mocked as a transparent pass-through by default.
// Individual tests can reconfigure mockCbInstance.fire to simulate circuit-open.
jest.mock('opossum', () => jest.fn());
import CircuitBreaker = require('opossum');

const MockCircuitBreaker = CircuitBreaker as unknown as jest.Mock;
let mockCbInstance: { fire: jest.Mock; on: jest.Mock; opened: boolean };

describe('DocumentClientService', () => {
  const documentServiceUrl = 'http://document-service';
  const internalToken = 'internal-token';
  let httpService: jest.Mocked<Pick<HttpService, 'get' | 'post'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'http' | 'log' | 'warn'>>;
  let service: DocumentClientService;

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
        if (key === 'DOCUMENT_SERVICE_URL')      return documentServiceUrl;
        if (key === 'INTERNAL_TOKEN_WORKFLOW_DOC') return internalToken;
        throw new Error(`Unknown key: ${key}`);
      }),
      get: jest.fn().mockReturnValue(1000),
    } as unknown as ConfigService;

    service = new DocumentClientService(
      httpService as unknown as HttpService,
      config,
      logger as unknown as AppLogger,
    );
  });

  it('gets typology public info with internal headers', async () => {
    const typology: TypologyPublicInfo = {
      id: 'typology-1',
      nombre: 'Contract',
      codigo: 'CTR',
      version: '1',
      estructuraOrg: {
        departamentoId: 'dept-1',
        departamentoNombre: 'Legal',
        areaId: null,
        areaNombre: null,
        cargoId: null,
        cargoNombre: null,
      },
    };
    httpService.get.mockReturnValue(of({ data: typology } as AxiosResponse<TypologyPublicInfo>));

    await expect(service.getTypologyInfo('org 1', 'typology-1')).resolves.toBe(typology);

    expect(httpService.get).toHaveBeenCalledWith(
      `${documentServiceUrl}/internal/typologies/typology-1/public-info?orgId=org%201`,
      {
        headers: {
          'x-internal-token': internalToken,
          [CORRELATION_ID_HEADER]: 'no-correlation-id',
        },
      },
    );
    expect(logger.http).toHaveBeenCalledWith(expect.objectContaining({ type: 'internal-response', statusCode: 200 }));
  });

  it('validates a document for workflow creation', async () => {
    const result: ValidateDocumentResult = {
      isValid: true,
      typology: { nombre: 'Contract', codigo: 'CTR', version: '1' },
      document: {
        extractedTitle: 'Contract',
        extractedCode: 'CTR',
        extractedVersion: '1',
        storageKey: 'documents/doc-1.pdf',
        originalName: 'doc.pdf',
        mimeType: 'application/pdf',
        fileSizeBytes: 123,
      },
      discrepancies: [],
    };
    httpService.post.mockReturnValue(of({ data: result } as AxiosResponse<ValidateDocumentResult>));

    await expect(service.validateDocument('typology-1', 'doc-1')).resolves.toBe(result);

    expect(httpService.post).toHaveBeenCalledWith(
      `${documentServiceUrl}/internal/documents/validate-for-workflow`,
      { typologyId: 'typology-1', documentId: 'doc-1' },
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-internal-token': internalToken }),
      }),
    );
  });

  it('maps 400 responses to BadRequestException', async () => {
    httpService.get.mockReturnValue(
      throwError(() => ({ response: { status: 400, data: { message: 'Invalid org' } } })),
    );

    await expect(service.getTypologyInfo('org-1', 'typology-1')).rejects.toThrow(BadRequestException);
  });

  it('maps 404 responses to NotFoundException without leaking internal service name', async () => {
    httpService.post.mockReturnValue(
      throwError(() => ({ response: { status: 404, data: { message: 'Missing document' } } })),
    );

    const error = await service
      .validateDocument('typology-1', 'doc-1')
      .then(() => null, (e) => e);

    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('Resource not found');
    expect(error.message).not.toContain('document-service');
  });

  it('maps timeout errors to GatewayTimeoutException', async () => {
    httpService.get.mockReturnValue(throwError(() => new TimeoutError()));

    await expect(service.getTypologyInfo('org-1', 'typology-1')).rejects.toThrow(GatewayTimeoutException);
  });

  it('maps unknown errors to InternalServerErrorException', async () => {
    httpService.post.mockReturnValue(throwError(() => new Error('network down')));

    await expect(service.validateDocument('typology-1', 'doc-1')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  // ── circuit breaker ──────────────────────────────────────────────────────

  it('throws ServiceUnavailableException when document-service circuit is open', async () => {
    mockCbInstance.fire.mockRejectedValueOnce(
      Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }),
    );

    await expect(service.getTypologyInfo('org-1', 'typology-1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('throws ServiceUnavailableException on validateDocument when circuit is open', async () => {
    mockCbInstance.fire.mockRejectedValueOnce(
      Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }),
    );

    await expect(service.validateDocument('typology-1', 'doc-1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('registers open/halfOpen/close handlers on the circuit breaker', () => {
    expect(mockCbInstance.on).toHaveBeenCalledWith('open', expect.any(Function));
    expect(mockCbInstance.on).toHaveBeenCalledWith('halfOpen', expect.any(Function));
    expect(mockCbInstance.on).toHaveBeenCalledWith('close', expect.any(Function));
  });
});

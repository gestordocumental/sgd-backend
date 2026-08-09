import { BadRequestException, GatewayTimeoutException, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { NEVER, of, throwError, TimeoutError } from 'rxjs';
import { AxiosResponse } from 'axios';
import {
  DocumentClientService,
  ReviewCycleEnabledResult,
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
      reviewCycleEnabled: false,
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

  // ── isReviewCycleEnabledForTypology ──────────────────────────────────────

  it('returns reviewCycleEnabled from document-service', async () => {
    const result: ReviewCycleEnabledResult = { id: 'typology-1', reviewCycleEnabled: true };
    httpService.get.mockReturnValue(of({ data: result } as AxiosResponse<ReviewCycleEnabledResult>));

    await expect(service.isReviewCycleEnabledForTypology('org-1', 'typology-1')).resolves.toBe(true);

    expect(httpService.get).toHaveBeenCalledWith(
      `${documentServiceUrl}/internal/typologies/typology-1/review-cycle-enabled?orgId=org-1`,
      {
        headers: {
          'x-internal-token': internalToken,
          [CORRELATION_ID_HEADER]: 'no-correlation-id',
        },
      },
    );
  });

  it('returns reviewCycleEnabled: false from document-service as-is (a genuine, validated answer)', async () => {
    const result: ReviewCycleEnabledResult = { id: 'typology-1', reviewCycleEnabled: false };
    httpService.get.mockReturnValue(of({ data: result } as AxiosResponse<ReviewCycleEnabledResult>));

    await expect(service.isReviewCycleEnabledForTypology('org-1', 'typology-1')).resolves.toBe(false);
  });

  it('throws InternalServerErrorException instead of defaulting to false when reviewCycleEnabled is missing from the response', async () => {
    httpService.get.mockReturnValue(
      of({ data: { id: 'typology-1' } } as unknown as AxiosResponse<ReviewCycleEnabledResult>),
    );

    await expect(service.isReviewCycleEnabledForTypology('org-1', 'typology-1')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('throws InternalServerErrorException instead of defaulting to false when reviewCycleEnabled is not a boolean', async () => {
    httpService.get.mockReturnValue(
      of({
        data: { id: 'typology-1', reviewCycleEnabled: null },
      } as unknown as AxiosResponse<ReviewCycleEnabledResult>),
    );

    await expect(service.isReviewCycleEnabledForTypology('org-1', 'typology-1')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('rejects a malformed response from inside the function handed to the circuit breaker, so it counts toward the breaker\'s own failure tracking', async () => {
    httpService.get.mockReturnValue(
      of({
        data: { id: 'typology-1', reviewCycleEnabled: 'not-a-boolean' },
      } as unknown as AxiosResponse<ReviewCycleEnabledResult>),
    );

    await expect(service.isReviewCycleEnabledForTypology('org-1', 'typology-1')).rejects.toThrow();

    expect(mockCbInstance.fire).toHaveBeenCalledTimes(1);
    const firedFn = mockCbInstance.fire.mock.calls[0][0] as () => Promise<unknown>;
    await expect(firedFn()).rejects.toThrow('Invalid reviewCycleEnabled response from document-service');
  });

  it('throws InternalServerErrorException instead of defaulting to false when document-service errors', async () => {
    httpService.get.mockReturnValue(throwError(() => new Error('network down')));

    await expect(service.isReviewCycleEnabledForTypology('org-1', 'typology-1')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('throws GatewayTimeoutException instead of defaulting to false on a timeout', async () => {
    httpService.get.mockReturnValue(throwError(() => new TimeoutError()));

    await expect(service.isReviewCycleEnabledForTypology('org-1', 'typology-1')).rejects.toThrow(
      GatewayTimeoutException,
    );
  });

  it('logs the effective (overridden) timeout, not the shared default, on a timeout with a tightened timeoutMs', async () => {
    httpService.get.mockReturnValue(throwError(() => new TimeoutError()));

    await expect(
      service.isReviewCycleEnabledForTypology('org-1', 'typology-1', 1_500, false),
    ).rejects.toThrow(GatewayTimeoutException);

    expect(logger.http).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('timed out after 1500ms') }),
    );
  });

  it('actually applies the overridden timeoutMs to the request, not just to the log message', async () => {
    // NEVER: the request never resolves on its own, so a rejection can only
    // come from the RxJS `timeout(timeoutMs)` operator itself — proving it's
    // really wired to the 200ms override. The override must be well below
    // the shared default this suite mocks ConfigService.get() to return
    // (1000ms, see beforeEach) — otherwise advancing fake timers past the
    // override value could also already be past the shared default, and the
    // assertion would pass even if the code silently fell back to
    // `this.timeoutMs` instead of the passed-in `timeoutMs` (verified this
    // was a real false-positive risk, not hypothetical, while writing this
    // test).
    httpService.get.mockReturnValue(NEVER);
    jest.useFakeTimers();

    try {
      const promise = service.isReviewCycleEnabledForTypology('org-1', 'typology-1', 200, false);
      const assertion = expect(promise).rejects.toThrow(GatewayTimeoutException);

      await jest.advanceTimersByTimeAsync(200);

      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('throws ServiceUnavailableException instead of defaulting to false when the circuit breaker is open', async () => {
    mockCbInstance.fire.mockRejectedValueOnce(
      Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }),
    );

    await expect(service.isReviewCycleEnabledForTypology('org-1', 'typology-1')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  // ── isReviewCycleEnabledForTypology — breaker isolation ──────────────────

  it('routes through the shared circuit breaker by default (useCircuitBreaker defaults to true)', async () => {
    const result: ReviewCycleEnabledResult = { id: 'typology-1', reviewCycleEnabled: true };
    httpService.get.mockReturnValue(of({ data: result } as AxiosResponse<ReviewCycleEnabledResult>));

    await service.isReviewCycleEnabledForTypology('org-1', 'typology-1', 1_500);

    expect(mockCbInstance.fire).toHaveBeenCalledTimes(1);
  });

  it('bypasses the shared circuit breaker entirely when useCircuitBreaker is false, calling document-service directly', async () => {
    const result: ReviewCycleEnabledResult = { id: 'typology-1', reviewCycleEnabled: true };
    httpService.get.mockReturnValue(of({ data: result } as AxiosResponse<ReviewCycleEnabledResult>));

    await expect(
      service.isReviewCycleEnabledForTypology('org-1', 'typology-1', 1_500, false),
    ).resolves.toBe(true);

    expect(mockCbInstance.fire).not.toHaveBeenCalled();
    expect(httpService.get).toHaveBeenCalledTimes(1);
  });

  it('does not let repeated bypassed-breaker failures poison the breaker shared with approve()/createCycle()', async () => {
    // Best-effort calls (useCircuitBreaker: false) fail repeatedly — as would
    // happen if document-service is merely slow relative to the tightened
    // read-path timeout, not actually down.
    httpService.get.mockReturnValue(throwError(() => new TimeoutError()));
    for (let i = 0; i < 10; i++) {
      await expect(
        service.isReviewCycleEnabledForTypology('org-1', 'typology-1', 1_500, false),
      ).rejects.toThrow(GatewayTimeoutException);
    }
    // None of those touched the breaker at all, so it never had a chance to
    // trip open from this traffic.
    expect(mockCbInstance.fire).not.toHaveBeenCalled();

    // An authoritative call (default useCircuitBreaker: true, as approve()/
    // createCycle() use it) right after must still go through normally —
    // proof the breaker was never poisoned by the calls above.
    httpService.get.mockReturnValue(
      of({ data: { id: 'typology-1', reviewCycleEnabled: true } } as AxiosResponse<ReviewCycleEnabledResult>),
    );
    await expect(service.isReviewCycleEnabledForTypology('org-1', 'typology-1')).resolves.toBe(true);
    expect(mockCbInstance.fire).toHaveBeenCalledTimes(1);
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

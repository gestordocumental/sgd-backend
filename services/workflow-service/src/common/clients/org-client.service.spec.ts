import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosResponse } from 'axios';
import { of, throwError, TimeoutError } from 'rxjs';
import { OrgClientService, ReviewCycleEnabledResult } from './org-client.service';
import { AppLogger, CORRELATION_ID_HEADER } from '@sgd/common';

// Circuit breaker is mocked as a transparent pass-through by default.
jest.mock('opossum', () => jest.fn());
import CircuitBreaker = require('opossum');

const MockCircuitBreaker = CircuitBreaker as unknown as jest.Mock;
let mockCbInstance: { fire: jest.Mock; on: jest.Mock; opened: boolean };

describe('OrgClientService', () => {
  const orgServiceUrl = 'http://org-service';
  const internalToken = 'internal-token';
  let httpService: jest.Mocked<Pick<HttpService, 'get'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'log' | 'warn'>>;
  let service: OrgClientService;

  beforeEach(() => {
    mockCbInstance = {
      fire: jest.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
      on: jest.fn(),
      opened: false,
    };
    MockCircuitBreaker.mockImplementation(() => mockCbInstance as any);

    httpService = {
      get: jest.fn(),
    };
    logger = {
      log: jest.fn(),
      warn: jest.fn(),
    };

    const config = {
      getOrThrow: jest.fn((key: string) => {
        if (key === 'ORG_SERVICE_URL')              return orgServiceUrl;
        if (key === 'INTERNAL_TOKEN_WORKFLOW_ORG')  return internalToken;
        throw new Error(`Unknown key: ${key}`);
      }),
      get: jest.fn().mockReturnValue(1000),
    } as unknown as ConfigService;

    service = new OrgClientService(
      httpService as unknown as HttpService,
      config,
      logger as unknown as AppLogger,
    );
  });

  it('returns reviewCycleEnabled from org-service', async () => {
    const result: ReviewCycleEnabledResult = { id: 'org-1', reviewCycleEnabled: false };
    httpService.get.mockReturnValue(of({ data: result } as AxiosResponse<ReviewCycleEnabledResult>));

    await expect(service.isReviewCycleEnabled('org-1')).resolves.toBe(false);

    expect(httpService.get).toHaveBeenCalledWith(
      `${orgServiceUrl}/internal/orgs/org-1/review-cycle-enabled`,
      {
        headers: {
          'x-internal-token': internalToken,
          [CORRELATION_ID_HEADER]: 'no-correlation-id',
        },
      },
    );
  });

  it('defaults to true (fail-open) instead of false when reviewCycleEnabled is missing from the response', async () => {
    httpService.get.mockReturnValue(
      of({ data: { id: 'org-1' } } as unknown as AxiosResponse<ReviewCycleEnabledResult>),
    );

    await expect(service.isReviewCycleEnabled('org-1')).resolves.toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve reviewCycleEnabled for org org-1'),
      'OrgClientService',
    );
  });

  it('defaults to true (fail-open) instead of false when reviewCycleEnabled is not a boolean', async () => {
    httpService.get.mockReturnValue(
      of({
        data: { id: 'org-1', reviewCycleEnabled: null },
      } as unknown as AxiosResponse<ReviewCycleEnabledResult>),
    );

    await expect(service.isReviewCycleEnabled('org-1')).resolves.toBe(true);
  });

  it('rejects a malformed response from inside the function handed to the circuit breaker, so it counts toward the breaker\'s own failure tracking', async () => {
    // A real CircuitBreaker only tracks failures of the promise returned by
    // the function passed to fire() — validating reviewCycleEnabled *after*
    // fireWithCb resolves would let org-service return garbage on every call
    // without the breaker ever seeing it as unhealthy. Asserting the captured
    // fn itself rejects (independent of the outer fail-open catch) proves the
    // validation is inside that boundary, not after it.
    httpService.get.mockReturnValue(
      of({
        data: { id: 'org-1', reviewCycleEnabled: 'not-a-boolean' },
      } as unknown as AxiosResponse<ReviewCycleEnabledResult>),
    );

    await service.isReviewCycleEnabled('org-1');

    expect(mockCbInstance.fire).toHaveBeenCalledTimes(1);
    const firedFn = mockCbInstance.fire.mock.calls[0][0] as () => Promise<unknown>;
    await expect(firedFn()).rejects.toThrow('Invalid reviewCycleEnabled response from org-service');
  });

  it('defaults to true (fail-open) instead of throwing when org-service errors', async () => {
    httpService.get.mockReturnValue(throwError(() => new Error('network down')));

    await expect(service.isReviewCycleEnabled('org-1')).resolves.toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve reviewCycleEnabled for org org-1'),
      'OrgClientService',
    );
  });

  it('defaults to true (fail-open) on a timeout', async () => {
    httpService.get.mockReturnValue(throwError(() => new TimeoutError()));

    await expect(service.isReviewCycleEnabled('org-1')).resolves.toBe(true);
  });

  it('defaults to true (fail-open) when the circuit breaker is open', async () => {
    mockCbInstance.fire.mockRejectedValueOnce(
      Object.assign(new Error('Breaker is open'), { code: 'EOPENBREAKER' }),
    );

    await expect(service.isReviewCycleEnabled('org-1')).resolves.toBe(true);
  });

  it('registers open/halfOpen/close handlers on the circuit breaker', () => {
    expect(mockCbInstance.on).toHaveBeenCalledWith('open', expect.any(Function));
    expect(mockCbInstance.on).toHaveBeenCalledWith('halfOpen', expect.any(Function));
    expect(mockCbInstance.on).toHaveBeenCalledWith('close', expect.any(Function));
  });
});

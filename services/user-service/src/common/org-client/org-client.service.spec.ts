import {
  BadRequestException,
  GatewayTimeoutException,
  InternalServerErrorException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { of, throwError, TimeoutError } from 'rxjs';
import { AppLogger } from '@sgd/common';
import { OrgClientService } from './org-client.service';

const ORG_SERVICE_URL = 'http://org-service:3000';
const INTERNAL_TOKEN = 'internal-token';

type ConfigValues = Record<string, string | number | undefined>;

function createService(configValues: ConfigValues = {}) {
  const httpService = {
    post: jest.fn(),
  } as unknown as jest.Mocked<HttpService>;

  const config = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as jest.Mocked<ConfigService>;

  const logger = {
    warn: jest.fn(),
    http: jest.fn(),
  } as unknown as jest.Mocked<AppLogger>;

  const service = new OrgClientService(httpService, config, logger);

  return { service, httpService, config, logger };
}

describe('OrgClientService', () => {
  it('skips validation and logs a warning when ORG_SERVICE_URL is not configured', async () => {
    const { service, httpService, logger } = createService({
      INTERNAL_TOKEN_USER_ORG: INTERNAL_TOKEN,
    });

    await service.validateOrgStructure('org-1', 'dep-1', 'area-1', 'cargo-1');

    expect(httpService.post).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('ORG_SERVICE_URL not configured'),
      'OrgClientService',
    );
  });

  it('skips validation when the internal token is not configured', async () => {
    const { service, httpService, logger } = createService({
      ORG_SERVICE_URL,
    });

    await service.validateOrgStructure('org-1', 'dep-1');

    expect(httpService.post).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('posts the structure ids to org-service with the internal token', async () => {
    const { service, httpService, logger } = createService({
      ORG_SERVICE_URL,
      INTERNAL_TOKEN_USER_ORG: INTERNAL_TOKEN,
      ORG_SERVICE_TIMEOUT_MS: '2500',
    });
    httpService.post.mockReturnValue(of({ status: 200, data: {} } as any));

    await service.validateOrgStructure('org-1', 'dep-1', 'area-1', 'cargo-1');

    expect(httpService.post).toHaveBeenCalledWith(
      `${ORG_SERVICE_URL}/internal/structure/resolve-by-ids`,
      {
        orgId: 'org-1',
        departamentoId: 'dep-1',
        areaId: 'area-1',
        cargoId: 'cargo-1',
      },
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-internal-token': INTERNAL_TOKEN,
        }),
      }),
    );
    expect(logger.http).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'internal-request', target: 'org-service' }),
    );
    expect(logger.http).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'internal-response',
        target: 'org-service',
        statusCode: 200,
      }),
    );
  });

  it('throws BadRequestException with the org-service message for validation errors', async () => {
    const { service, httpService, logger } = createService({
      ORG_SERVICE_URL,
      INTERNAL_TOKEN_USER_ORG: INTERNAL_TOKEN,
    });
    httpService.post.mockReturnValue(
      throwError(() => ({
        response: { status: 400, data: { message: 'Invalid org structure' } },
      })),
    );

    await expect(service.validateOrgStructure('org-1', 'dep-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.validateOrgStructure('org-1', 'dep-1')).rejects.toThrow(
      'Invalid org structure',
    );
    expect(logger.http).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusCode: 400 }),
    );
  });

  it('throws GatewayTimeoutException when org-service times out', async () => {
    const { service, httpService, logger } = createService({
      ORG_SERVICE_URL,
      INTERNAL_TOKEN_USER_ORG: INTERNAL_TOKEN,
      ORG_SERVICE_TIMEOUT_MS: 100,
    });
    httpService.post.mockReturnValue(throwError(() => new TimeoutError()));

    await expect(service.validateOrgStructure('org-1', 'dep-1')).rejects.toThrow(
      GatewayTimeoutException,
    );
    expect(logger.http).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusCode: 504 }),
    );
  });

  it('throws InternalServerErrorException for non-validation errors', async () => {
    const { service, httpService, logger } = createService({
      ORG_SERVICE_URL,
      INTERNAL_TOKEN_USER_ORG: INTERNAL_TOKEN,
    });
    httpService.post.mockReturnValue(
      throwError(() => ({
        response: { status: 503, data: { message: 'Unavailable' } },
      })),
    );

    await expect(service.validateOrgStructure('org-1', 'dep-1')).rejects.toThrow(
      InternalServerErrorException,
    );
    await expect(service.validateOrgStructure('org-1', 'dep-1')).rejects.toThrow(
      'Could not validate org structure: Unavailable',
    );
    expect(logger.http).toHaveBeenLastCalledWith(
      expect.objectContaining({ statusCode: 503 }),
    );
  });
});

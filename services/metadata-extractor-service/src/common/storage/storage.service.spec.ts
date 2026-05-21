import { Readable } from 'stream';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

function makeService(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    STORAGE_BUCKET: 'metadata-bucket',
    STORAGE_ENDPOINT: 'http://storage.local',
    STORAGE_ACCESS_KEY: 'access-key',
    STORAGE_SECRET_KEY: 'secret-key',
    STORAGE_REGION: undefined,
    STORAGE_FORCE_PATH: undefined,
    ...overrides,
  };

  const config = {
    getOrThrow: jest.fn((key: string) => {
      const value = values[key];
      if (value === undefined) {
        throw new Error(`Missing config ${key}`);
      }
      return value;
    }),
    get: jest.fn((key: string) => values[key]),
  };
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
  };

  return {
    config,
    logger,
    service: new StorageService(config as any, logger as any),
  };
}

function streamFrom(text: string): Readable {
  return Readable.from([Buffer.from(text)]);
}

describe('StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('initializes an S3 client from configuration', () => {
    const { logger, service } = makeService({
      STORAGE_REGION: 'us-east-1',
      STORAGE_FORCE_PATH: 'true',
    });

    service.onModuleInit();

    expect(S3Client).toHaveBeenCalledWith({
      endpoint: 'http://storage.local',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      },
      forcePathStyle: true,
      maxAttempts: 3,
    });
    expect(logger.log).toHaveBeenCalledWith(
      'StorageService (read-only) initialized',
      'StorageService',
    );
  });

  it('defaults the region to auto and forcePathStyle to false', () => {
    const { service } = makeService();

    service.onModuleInit();

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'auto',
        forcePathStyle: false,
      }),
    );
  });

  it('downloads an object body into a buffer', async () => {
    const { service } = makeService();
    service.onModuleInit();
    mockSend.mockResolvedValue({ Body: streamFrom('hello world') });

    await expect(service.download('docs/policy.pdf')).resolves.toEqual(
      Buffer.from('hello world'),
    );

    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: 'metadata-bucket',
      Key: 'docs/policy.pdf',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('retries retryable download errors before succeeding', async () => {
    const setTimeoutSpy = jest
      .spyOn(global, 'setTimeout')
      .mockImplementation(((callback: () => void) => {
        callback();
        return 0 as unknown as NodeJS.Timeout;
      }) as typeof setTimeout);
    const { logger, service } = makeService();
    service.onModuleInit();
    mockSend
      .mockRejectedValueOnce(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))
      .mockResolvedValueOnce({ Body: streamFrom('after retry') });

    await expect(service.download('retry.txt')).resolves.toEqual(
      Buffer.from('after retry'),
    );

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('download attempt 1 failed (ECONNRESET)'),
      'StorageService',
    );

    setTimeoutSpy.mockRestore();
  });

  it('throws non-retryable download errors without retrying', async () => {
    const { logger, service } = makeService();
    service.onModuleInit();
    mockSend.mockRejectedValue(Object.assign(new Error('denied'), { code: 'AccessDenied' }));

    await expect(service.download('denied.txt')).rejects.toThrow('denied');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

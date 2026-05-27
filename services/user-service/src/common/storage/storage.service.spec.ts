import { InternalServerErrorException } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PutObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  DeleteObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

function makeService(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    STORAGE_ENDPOINT: 'http://storage.local',
    STORAGE_ACCESS_KEY: 'access-key',
    STORAGE_SECRET_KEY: 'secret-key',
    STORAGE_BUCKET: 'user-bucket',
    STORAGE_PUBLIC_URL: 'https://cdn.example.com/',
    STORAGE_REGION: undefined,
    STORAGE_FORCE_PATH: undefined,
    ...overrides,
  };

  const config = {
    get: jest.fn((key: string) => values[key]),
  };

  return {
    config,
    service: new StorageService(config as any),
  };
}

describe('StorageService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
  });

  it('uploads a buffer and returns the public URL', async () => {
    const { service } = makeService({
      STORAGE_REGION: 'us-east-1',
      STORAGE_FORCE_PATH: 'true',
    });
    const buffer = Buffer.from('avatar');

    await expect(service.upload('avatars/user.png', buffer, 'image/png')).resolves.toBe(
      'https://cdn.example.com/avatars/user.png',
    );

    expect(S3Client).toHaveBeenCalledWith({
      endpoint: 'http://storage.local',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'access-key',
        secretAccessKey: 'secret-key',
      },
      forcePathStyle: true,
    });
    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'user-bucket',
      Key: 'avatars/user.png',
      Body: buffer,
      ContentType: 'image/png',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('defaults region to auto and forcePathStyle to false', async () => {
    const { service } = makeService();

    await service.upload('avatars/default.webp', Buffer.from('x'), 'image/webp');

    expect(S3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        region: 'auto',
        forcePathStyle: false,
      }),
    );
  });

  it('deletes an object by key', async () => {
    const { service } = makeService();

    await service.delete('avatars/old.png');

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: 'user-bucket',
      Key: 'avatars/old.png',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('extracts a storage key only for matching public URLs', () => {
    const { service } = makeService();

    expect(service.extractKey('https://cdn.example.com/avatars/user.png')).toBe(
      'avatars/user.png',
    );
    expect(service.extractKey('https://other.example.com/avatars/user.png')).toBeNull();
  });

  it('throws when a required storage config value is missing', async () => {
    const { service } = makeService({ STORAGE_ENDPOINT: undefined });

    await expect(
      service.upload('avatars/user.png', Buffer.from('x'), 'image/png'),
    ).rejects.toThrow(InternalServerErrorException);
  });
});

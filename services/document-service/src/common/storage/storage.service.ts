import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { AppLogger } from '@sgd/common';

@Injectable()
export class StorageService implements OnModuleInit {
  private client!: S3Client;
  private bucket!: string;
  private expirySeconds!: number;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit() {
    this.bucket        = this.config.getOrThrow<string>('STORAGE_BUCKET');
    this.expirySeconds = Number(this.config.get<string>('SIGNED_URL_EXPIRY') ?? '300');

    this.client = new S3Client({
      endpoint:        this.config.getOrThrow<string>('STORAGE_ENDPOINT'),
      region:          this.config.get<string>('STORAGE_REGION') ?? 'auto',
      credentials: {
        accessKeyId:     this.config.getOrThrow<string>('STORAGE_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('STORAGE_SECRET_KEY'),
      },
      forcePathStyle: this.config.get<string>('STORAGE_FORCE_PATH') === 'true',
    });

    this.logger.log('StorageService initialized', 'StorageService');
  }

  /**
   * Uploads a file to the private bucket.
   * Key format: org/{orgId}/typologies/{typologyId}/{uuid}.{ext}
   */
  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket:      this.bucket,
        Key:         key,
        Body:        buffer,
        ContentType: contentType,
      }),
    );
    this.logger.log(`Uploaded: ${key}`, 'StorageService');
  }

  /**
   * Generates a pre-signed GET URL valid for SIGNED_URL_EXPIRY seconds.
   * The file is never served directly through the application.
   */
  async getSignedDownloadUrl(
    key: string,
    filename?: string,
    mimeType?: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const disposition = filename
      ? `${mimeType === 'application/pdf' ? 'inline' : 'attachment'}; filename="${filename.replace(/"/g, '\\"')}"`
      : undefined;

    const url = await getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key:    key,
        ...(disposition ? { ResponseContentDisposition: disposition } : {}),
      }),
      { expiresIn: this.expirySeconds },
    );

    const expiresAt = new Date(Date.now() + this.expirySeconds * 1000);
    return { url, expiresAt };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    this.logger.log(`Deleted: ${key}`, 'StorageService');
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

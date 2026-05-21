import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

@Injectable()
export class StorageService {
  private _client: S3Client | null = null;
  private _bucket: string | null = null;
  private _publicUrl: string | null = null;

  constructor(private readonly config: ConfigService) {}

  private get client(): S3Client {
    if (!this._client) {
      this._client = new S3Client({
        endpoint:      this.cfg('STORAGE_ENDPOINT'),
        region:        this.config.get<string>('STORAGE_REGION') ?? 'auto',
        credentials: {
          accessKeyId:     this.cfg('STORAGE_ACCESS_KEY'),
          secretAccessKey: this.cfg('STORAGE_SECRET_KEY'),
        },
        forcePathStyle: this.config.get<string>('STORAGE_FORCE_PATH') === 'true',
      });
    }
    return this._client;
  }

  private get bucket(): string {
    if (!this._bucket) this._bucket = this.cfg('STORAGE_BUCKET');
    return this._bucket;
  }

  private get publicUrl(): string {
    if (!this._publicUrl)
      this._publicUrl = this.cfg('STORAGE_PUBLIC_URL').replace(/\/$/, '');
    return this._publicUrl;
  }

  private cfg(key: string): string {
    const value = this.config.get<string>(key);
    if (!value)
      throw new InternalServerErrorException(
        `Storage is not configured: missing env var ${key}`,
      );
    return value;
  }

  /** Uploads a buffer to the bucket and returns the public URL. */
  async upload(key: string, buffer: Buffer, contentType: string): Promise<string> {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket:      this.bucket,
        Key:         key,
        Body:        buffer,
        ContentType: contentType,
      }));
      return `${this.publicUrl}/${key}`;
    } catch (err) {
      throw new InternalServerErrorException(
        `Failed to upload file to storage: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (err) {
      throw new InternalServerErrorException(
        `Failed to delete file from storage: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
  }

  /**
   * Given a stored public URL, extracts the S3 key.
   * Returns null if the URL does not match this bucket's public URL.
   */
  extractKey(url: string): string | null {
    const prefix = `${this.publicUrl}/`;
    return url.startsWith(prefix) ? url.slice(prefix.length) : null;
  }
}

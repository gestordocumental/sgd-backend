import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { AppLogger } from '@sgd/common';
import { Readable } from 'stream';

@Injectable()
export class StorageService implements OnModuleInit {
  private client!: S3Client;
  private bucket!: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit() {
    this.bucket = this.config.getOrThrow<string>('STORAGE_BUCKET');
    this.client = new S3Client({
      endpoint:    this.config.getOrThrow<string>('STORAGE_ENDPOINT'),
      region:      this.config.get<string>('STORAGE_REGION') ?? 'auto',
      credentials: {
        accessKeyId:     this.config.getOrThrow<string>('STORAGE_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('STORAGE_SECRET_KEY'),
      },
      forcePathStyle: this.config.get<string>('STORAGE_FORCE_PATH') === 'true',
      maxAttempts: 3,
    });
    this.logger.log('StorageService (read-only) initialized', 'StorageService');
  }

  /** Downloads a file as a Buffer. Only used internally — file never leaves this service. */
  async download(key: string, retries = 3): Promise<Buffer> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key }),
        );
        const stream = response.Body as Readable;
        return await new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          stream.on('data', (chunk: Buffer) => chunks.push(chunk));
          stream.on('end', () => resolve(Buffer.concat(chunks)));
          stream.on('error', reject);
        });
      } catch (err: any) {
        const isRetryable = err?.code === 'ECONNRESET' || err?.code === 'ETIMEDOUT' || err?.code === 'ENOTFOUND';
        if (isRetryable && attempt < retries) {
          const delay = attempt * 500;
          this.logger.warn(`download attempt ${attempt} failed (${err.code}), retrying in ${delay}ms…`, 'StorageService');
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    // unreachable — satisfies TS
    throw new Error('download failed after retries');
  }
}

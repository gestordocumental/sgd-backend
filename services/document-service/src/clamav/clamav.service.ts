import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as net from 'net';
import { AppLogger } from '@sgd/common';

export interface ScanResult {
  clean: boolean;
  threat?: string;
}

const CHUNK_SIZE = 4096;

@Injectable()
export class ClamavService {
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly required: boolean;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.host      = config.get<string>('CLAMAV_HOST', 'localhost');
    this.port      = config.get<number>('CLAMAV_PORT', 3310);
    this.timeoutMs = config.get<number>('CLAMAV_TIMEOUT_MS', 15000);
    this.required  = config.get<string>('CLAMAV_REQUIRED', 'false') === 'true';
  }

  /**
   * Streams a buffer to ClamAV via the INSTREAM protocol.
   * - If ClamAV is unreachable and CLAMAV_REQUIRED=false, logs a warning and passes through.
   * - If ClamAV is unreachable and CLAMAV_REQUIRED=true, throws InternalServerErrorException.
   */
  async scan(buffer: Buffer): Promise<ScanResult> {
    try {
      return await this.streamScan(buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (this.required) {
        this.logger.error(`ClamAV unavailable — upload blocked (CLAMAV_REQUIRED=true): ${msg}`, undefined, 'ClamavService');
        throw new InternalServerErrorException('Malware scanning service is unavailable. Upload blocked.');
      }
      this.logger.warn(`ClamAV unavailable — proceeding without scan (CLAMAV_REQUIRED=false): ${msg}`, 'ClamavService');
      return { clean: true };
    }
  }

  private streamScan(buffer: Buffer): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const chunks: Buffer[] = [];

      socket.setTimeout(this.timeoutMs);

      socket.connect(this.port, this.host, () => {
        socket.write('zINSTREAM\0');

        for (let offset = 0; offset < buffer.length; offset += CHUNK_SIZE) {
          const slice = buffer.subarray(offset, offset + CHUNK_SIZE);
          const lenBuf = Buffer.allocUnsafe(4);
          lenBuf.writeUInt32BE(slice.length, 0);
          socket.write(lenBuf);
          socket.write(slice);
        }

        // Zero-length chunk signals end of stream to clamd
        socket.write(Buffer.alloc(4));
      });

      socket.on('data', (d) => chunks.push(d));

      socket.on('end', () => {
        socket.destroy();
        // Response: "stream: OK" or "stream: <ThreatName> FOUND"
        const response = Buffer.concat(chunks).toString().replace(/\0/g, '').trim();
        if (response.endsWith('OK')) {
          resolve({ clean: true });
        } else {
          const match = response.match(/stream: (.+) FOUND/);
          resolve({ clean: false, threat: match?.[1] ?? response });
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error(`ClamAV timed out after ${this.timeoutMs}ms`));
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });
    });
  }
}

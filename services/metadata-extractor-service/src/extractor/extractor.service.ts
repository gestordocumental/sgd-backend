import {
  Injectable, Inject, OnApplicationBootstrap, OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { AppLogger, KAFKA_CLIENT, KafkaProducerService, TOPICS, runWithCorrelation } from '@sgd/common';
import { StorageService } from '../common/storage/storage.service';
import { MetadataRulesService } from './rules/metadata-rules.service';
import { extractStructured } from './parsers/parser.factory';

interface FileUploadedPayload {
  orgId: string;
  typologyId: string;
  r2Key: string;
  mimeType: string;
  orgName?: string;
}

/**
 * Type guard that checks whether a value conforms to the FileUploadedPayload shape.
 *
 * @param raw - Value to validate
 * @returns `true` if `raw` matches FileUploadedPayload: required non-empty `orgId`, `typologyId`, `r2Key`, and `mimeType` (strings), and an optional `orgName` that may be `null/undefined` or a string; `false` otherwise.
 */
function isValidFileUploadedPayload(raw: unknown): raw is FileUploadedPayload {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  return (
    typeof p['orgId']       === 'string' && p['orgId'].trim().length       > 0 &&
    typeof p['typologyId']  === 'string' && p['typologyId'].trim().length  > 0 &&
    typeof p['r2Key']       === 'string' && p['r2Key'].trim().length       > 0 &&
    typeof p['mimeType']    === 'string' && p['mimeType'].trim().length    > 0 &&
    (p['orgName'] == null || typeof p['orgName'] === 'string')
  );
}

@Injectable()
export class ExtractorService implements OnApplicationBootstrap, OnApplicationShutdown {
  private consumer!: Consumer;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    private readonly config: ConfigService,
    private readonly producer: KafkaProducerService,
    private readonly storage: StorageService,
    private readonly rules: MetadataRulesService,
    private readonly logger: AppLogger,
  ) {}

  async onApplicationBootstrap() {
    const groupId = this.config.getOrThrow<string>('KAFKA_CONSUMER_GROUP');
    this.consumer = this.kafka.consumer({
      groupId,
      // Connection-level retry: reconnects up to 3 times on broker unavailability.
      // Message-level failures are handled internally by handleFileUploaded, which
      // emits typology.metadata.extraction.failed on any processing error.
      retry: { initialRetryTime: 300, retries: 3 },
    });

    await this.consumer.connect();
    await this.subscribeWithRetry();

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await runWithCorrelation(payload.message, () => this.handleFileUploaded(payload));
      },
    });

    this.logger.log('Extractor consumer listening for typology.file.uploaded', 'ExtractorService');
  }

  private async subscribeWithRetry(maxAttempts = 10, delayMs = 3000): Promise<void> {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.consumer.subscribe({ topics: [TOPICS.TYPOLOGY_FILE_UPLOADED], fromBeginning: false });
        return;
      } catch (err: any) {
        if (err?.type === 'UNKNOWN_TOPIC_OR_PARTITION' && attempt < maxAttempts) {
          this.logger.warn(
            `Topic not ready yet (attempt ${attempt}/${maxAttempts}), retrying in ${delayMs}ms…`,
            'ExtractorService',
          );
          await new Promise((r) => setTimeout(r, delayMs));
        } else {
          throw err;
        }
      }
    }
  }

  async onApplicationShutdown() {
    await this.consumer?.disconnect();
  }

  private async handleFileUploaded({ message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    let raw: unknown;
    try {
      raw = JSON.parse(message.value.toString());
    } catch {
      this.logger.warn('Malformed JSON in message — skipping', 'ExtractorService');
      return;
    }

    if (!isValidFileUploadedPayload(raw)) {
      this.logger.warn('Invalid payload — missing or malformed required fields', 'ExtractorService');
      return;
    }

    const { orgId, typologyId, r2Key, mimeType, orgName } = raw;

    this.logger.log(`Extracting metadata for typology ${typologyId}`, 'ExtractorService');

    try {
      // Download file directly from storage — never passes through document-service
      const buffer = await this.storage.download(r2Key);

      // Extract structured content (text + header table cells)
      const structured = await extractStructured(buffer, mimeType);

      if (structured === null) {
        await this.emitFailure(orgId, typologyId, `Formato de archivo no soportado: ${mimeType}`);
        return;
      }

      if (structured.text.trim().length === 0) {
        await this.emitFailure(orgId, typologyId, 'El documento no contiene texto extraíble (puede ser un escaneo o imagen)');
        return;
      }

      // Apply rules to find nombre, codigo, version
      const extracted = this.rules.extract({
        text:      structured.text,
        titleCell: structured.titleCell,
        leftCell:  structured.leftCell,
        rightCell: structured.rightCell,
        orgName,
      });

      await this.producer.emit(TOPICS.TYPOLOGY_METADATA_EXTRACTED, {
        orgId,
        typologyId,
        nombre:  extracted.nombre,
        codigo:  extracted.codigo,
        version: extracted.version,
      });

      this.logger.log(`Metadata extracted for typology ${typologyId}: ${JSON.stringify(extracted)}`, 'ExtractorService');
    } catch (err: any) {
      this.logger.error(`Extraction failed for typology ${typologyId}: ${err?.message}`, err?.stack, 'ExtractorService');
      try {
        await this.emitFailure(orgId, typologyId, 'Extraction failed due to an internal error');
      } catch (emitErr: any) {
        this.logger.error(
          `Failed to emit extraction failure for typology ${typologyId}: ${emitErr?.message}`,
          emitErr?.stack,
          'ExtractorService',
        );
      }
    }
  }

  private async emitFailure(orgId: string, typologyId: string, reason: string): Promise<void> {
    await this.producer.emit(TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED, { orgId, typologyId, reason });
  }
}

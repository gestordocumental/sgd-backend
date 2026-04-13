import {
  Injectable, Inject, OnApplicationBootstrap, OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { KAFKA_CLIENT, TOPICS } from '../common/kafka/kafka.constants';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';
import { runWithCorrelation } from '../common/kafka/kafka-consumer.util';
import { StorageService } from '../common/storage/storage.service';
import { MetadataRulesService } from './rules/metadata-rules.service';
import { extractText } from './parsers/parser.factory';
import { AppLogger } from '../common/logger/app-logger.service';

interface FileUploadedPayload {
  orgId: string;
  typologyId: string;
  r2Key: string;
  mimeType: string;
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
    this.consumer = this.kafka.consumer({ groupId });

    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [TOPICS.TYPOLOGY_FILE_UPLOADED], fromBeginning: false });

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await runWithCorrelation(payload.message, () => this.handleFileUploaded(payload));
      },
    });

    this.logger.log('Extractor consumer listening for typology.file.uploaded', 'ExtractorService');
  }

  async onApplicationShutdown() {
    await this.consumer?.disconnect();
  }

  private async handleFileUploaded({ message }: EachMessagePayload): Promise<void> {
    if (!message.value) return;

    const payload = JSON.parse(message.value.toString()) as FileUploadedPayload;
    const { orgId, typologyId, r2Key, mimeType } = payload;

    this.logger.log(`Extracting metadata for typology ${typologyId}`, 'ExtractorService');

    try {
      // Download file directly from storage — never passes through document-service
      const buffer = await this.storage.download(r2Key);

      // Extract plain text using the appropriate parser
      const text = await extractText(buffer, mimeType);

      if (text === null) {
        await this.emitFailure(orgId, typologyId, `Formato de archivo no soportado: ${mimeType}`);
        return;
      }

      if (text.trim().length === 0) {
        await this.emitFailure(orgId, typologyId, 'El documento no contiene texto extraíble (puede ser un escaneo o imagen)');
        return;
      }

      // Apply regex rules to find nombre, codigo, version
      const extracted = this.rules.extract(text);

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
      await this.emitFailure(orgId, typologyId, err?.message ?? 'Error desconocido durante la extracción');
    }
  }

  private async emitFailure(orgId: string, typologyId: string, reason: string): Promise<void> {
    await this.producer.emit(TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED, { orgId, typologyId, reason });
  }
}

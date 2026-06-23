import {
  Injectable, Inject, OnApplicationBootstrap, OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { Types } from 'mongoose';
import { AppLogger, KAFKA_CLIENT, KafkaProducerService, TOPICS, runWithCorrelation, withDlt } from '@sgd/common';

interface MetadataExtractedPayload {
  orgId: string;
  typologyId: string;
  nombre: string | null;
  codigo: string | null;
  version: string | null;
}

interface MetadataExtractionFailedPayload {
  orgId: string;
  typologyId: string;
  reason: string;
}

/**
 * Type guard that verifies a value conforms to the MetadataExtractedPayload shape.
 *
 * Validates that `orgId` is a non-empty string, `typologyId` is a string accepted by
 * `Types.ObjectId.isValid`, and that `nombre`, `codigo`, and `version` are either `null` or strings.
 *
 * @param raw - The value to validate as a MetadataExtractedPayload
 * @returns `true` if `raw` matches the MetadataExtractedPayload structure, `false` otherwise
 */
function isValidExtractedPayload(raw: unknown): raw is MetadataExtractedPayload {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  return (
    typeof p['orgId'] === 'string' && p['orgId'].length > 0 &&
    typeof p['typologyId'] === 'string' && Types.ObjectId.isValid(p['typologyId']) &&
    (p['nombre'] === null || typeof p['nombre'] === 'string') &&
    (p['codigo'] === null || typeof p['codigo'] === 'string') &&
    (p['version'] === null || typeof p['version'] === 'string')
  );
}

/**
 * Checks whether a value conforms to the MetadataExtractionFailedPayload shape.
 *
 * @param raw - Value to validate as a failed metadata extraction payload
 * @returns `true` if `raw` has a non-empty `orgId`, a `typologyId` that is a valid ObjectId, and a string `reason`, `false` otherwise.
 */
function isValidFailedPayload(raw: unknown): raw is MetadataExtractionFailedPayload {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  return (
    typeof p['orgId'] === 'string' && p['orgId'].length > 0 &&
    typeof p['typologyId'] === 'string' && Types.ObjectId.isValid(p['typologyId']) &&
    typeof p['reason'] === 'string'
  );
}

/**
 * KafkaConsumerService — subscribes to extraction result topics.
 * The handler callbacks are injected at runtime to avoid circular dependencies.
 */
@Injectable()
export class KafkaConsumerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private consumer!: Consumer;

  private onExtracted?: (payload: MetadataExtractedPayload) => Promise<void>;
  private onFailed?:   (payload: MetadataExtractionFailedPayload) => Promise<void>;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
    private readonly producer: KafkaProducerService,
  ) {}

  registerHandlers(
    onExtracted: (p: MetadataExtractedPayload) => Promise<void>,
    onFailed: (p: MetadataExtractionFailedPayload) => Promise<void>,
  ) {
    this.onExtracted = onExtracted;
    this.onFailed    = onFailed;
  }

  async onApplicationBootstrap() {
    const groupId = this.config.getOrThrow<string>('KAFKA_CONSUMER_GROUP');
    this.consumer = this.kafka.consumer({
      groupId,
      retry: { initialRetryTime: 300, retries: 3 },
    });

    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [TOPICS.TYPOLOGY_METADATA_EXTRACTED, TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED], fromBeginning: false });

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await runWithCorrelation(payload.message, () =>
          withDlt(
            {
              topic: payload.topic,
              message: payload.message,
              producer: this.producer,
              logger: this.logger,
              context: 'KafkaConsumerService',
            },
            () => this.dispatch(payload),
          ),
        );
      },
    });

    this.logger.log('Kafka consumer connected and listening', 'KafkaConsumerService');
  }

  async onApplicationShutdown() {
    await this.consumer?.disconnect();
    this.logger.log('Kafka consumer disconnected', 'KafkaConsumerService');
  }

  private async dispatch({ topic, message }: EachMessagePayload) {
    if (!message.value) return;

    let raw: unknown;
    try {
      raw = JSON.parse(message.value.toString());
    } catch {
      this.logger.warn(`[kafka] Malformed JSON in topic ${topic} — skipping`, 'KafkaConsumerService');
      return;
    }

    this.logger.http({ type: 'kafka-consume', topic, message: `← [kafka] ${topic}` });

    if (topic === TOPICS.TYPOLOGY_METADATA_EXTRACTED && this.onExtracted) {
      if (!isValidExtractedPayload(raw)) {
        this.logger.warn(`[kafka] Invalid payload in ${topic} — skipping: ${JSON.stringify(raw)}`, 'KafkaConsumerService');
        return;
      }
      await this.onExtracted(raw);
    } else if (topic === TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED && this.onFailed) {
      if (!isValidFailedPayload(raw)) {
        this.logger.warn(`[kafka] Invalid payload in ${topic} — skipping: ${JSON.stringify(raw)}`, 'KafkaConsumerService');
        return;
      }
      await this.onFailed(raw);
    }
  }
}

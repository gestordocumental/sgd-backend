import {
  Injectable,
  Inject,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { KAFKA_CLIENT, TOPICS, runWithCorrelation, withDlt, KafkaProducerService, AppLogger } from '@sgd/common';
import { AuditService } from './audit.service';
import { isValidAuditLogEvent } from './dto/audit-log-event.dto';

@Injectable()
export class AuditConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private consumer!: Consumer;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
    private readonly logger: AppLogger,
    private readonly producer: KafkaProducerService,
  ) {}

  async onApplicationBootstrap() {
    const groupId = this.config.getOrThrow<string>('KAFKA_CONSUMER_GROUP');
    this.consumer = this.kafka.consumer({
      groupId,
      // Connection-level retry: reconnects up to 3 times on broker unavailability.
      // Message-level retry is handled by withDlt inside eachMessage.
      retry: { initialRetryTime: 300, retries: 3 },
    });

    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [TOPICS.AUDIT_LOG],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await runWithCorrelation(payload.message, () =>
          withDlt(
            {
              topic: payload.topic,
              message: payload.message,
              producer: this.producer,
              logger: this.logger,
              context: 'AuditConsumer',
            },
            () => this.handleMessage(payload),
          ),
        );
      },
    });

    this.logger.log(
      `Kafka consumer connected — listening on [${TOPICS.AUDIT_LOG}]`,
      'AuditConsumer',
    );
  }

  async onApplicationShutdown() {
    await this.consumer?.disconnect();
    this.logger.log('Kafka consumer disconnected', 'AuditConsumer');
  }

  private async handleMessage({ topic, message }: EachMessagePayload) {
    if (!message.value) return;

    let raw: unknown;
    try {
      raw = JSON.parse(message.value.toString());
    } catch {
      this.logger.warn(
        `[kafka] Malformed JSON in topic ${topic} — skipping`,
        'AuditConsumer',
      );
      return;
    }

    this.logger.http({ type: 'kafka-consume', topic, message: `← [kafka] ${topic}` });

    if (!isValidAuditLogEvent(raw)) {
      const keys = raw && typeof raw === 'object' ? Object.keys(raw as Record<string, unknown>) : [];
      this.logger.warn(
        `[kafka] Invalid audit.log payload — skipping (keys=${keys.join(',')})`,
        'AuditConsumer',
      );
      return;
    }

    await this.auditService.index(raw);
  }
}

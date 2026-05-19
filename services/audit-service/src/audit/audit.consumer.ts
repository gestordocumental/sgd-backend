import {
  Injectable,
  Inject,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { KAFKA_CLIENT, TOPICS } from '../common/kafka/kafka.constants';
import { runWithCorrelation } from '../common/kafka/kafka-consumer.util';
import { AppLogger } from '../common/logger/app-logger.service';
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
  ) {}

  async onApplicationBootstrap() {
    const groupId = this.config.getOrThrow<string>('KAFKA_CONSUMER_GROUP');
    this.consumer = this.kafka.consumer({ groupId });

    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [TOPICS.AUDIT_LOG],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await runWithCorrelation(payload.message, async () => {
          await this.handleMessage(payload);
        }).catch((err: unknown) => {
          this.logger.error(
            `[kafka] Unhandled error processing message from topic ${payload.topic}: ${err instanceof Error ? err.message : String(err)}`,
            err instanceof Error ? err.stack : undefined,
            'AuditConsumer',
          );
        });
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
      this.logger.warn(
        `[kafka] Invalid audit.log payload — skipping: ${JSON.stringify(raw)}`,
        'AuditConsumer',
      );
      return;
    }

    await this.auditService.index(raw);
  }
}

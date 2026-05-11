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
import { NotificationsService } from './notifications.service';
import { NotificationType } from './entities/notification.entity';

interface NotificationPayload {
  type: NotificationType;
  recipientUserIds: string[];
  workflowId?: string;
  workflowTitle?: string;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

function isValidPayload(raw: unknown): raw is NotificationPayload {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  return (
    typeof p['type'] === 'string' &&
    Array.isArray(p['recipientUserIds']) &&
    (p['recipientUserIds'] as unknown[]).every((id) => typeof id === 'string') &&
    typeof p['message'] === 'string'
  );
}

@Injectable()
export class NotificationsConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private consumer!: Consumer;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly logger: AppLogger,
  ) {}

  async onApplicationBootstrap() {
    const groupId = this.config.getOrThrow<string>('KAFKA_CONSUMER_GROUP');
    this.consumer = this.kafka.consumer({ groupId });

    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [TOPICS.NOTIFICATION_SEND],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await runWithCorrelation(payload.message, async () => {
          await this.handleMessage(payload);
        });
      },
    });

    this.logger.log(
      `Kafka consumer connected — listening on [${TOPICS.NOTIFICATION_SEND}]`,
      'NotificationsConsumer',
    );
  }

  async onApplicationShutdown() {
    await this.consumer?.disconnect();
    this.logger.log('Kafka consumer disconnected', 'NotificationsConsumer');
  }

  private async handleMessage({ topic, message }: EachMessagePayload) {
    if (!message.value) return;

    let raw: unknown;
    try {
      raw = JSON.parse(message.value.toString());
    } catch {
      this.logger.warn(
        `[kafka] Malformed JSON in topic ${topic} — skipping`,
        'NotificationsConsumer',
      );
      return;
    }

    this.logger.http({ type: 'kafka-consume', topic, message: `← [kafka] ${topic}` });

    if (!isValidPayload(raw)) {
      this.logger.warn(
        `[kafka] Invalid payload in ${topic} — skipping: ${JSON.stringify(raw)}`,
        'NotificationsConsumer',
      );
      return;
    }

    await this.notificationsService.dispatch({
      type:             raw.type,
      recipientUserIds: raw.recipientUserIds,
      message:          raw.message,
      workflowId:       raw.workflowId ?? null,
      workflowTitle:    raw.workflowTitle ?? null,
      metadata:         raw.metadata,
    });
  }
}

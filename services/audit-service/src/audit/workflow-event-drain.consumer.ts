import {
  Injectable,
  Inject,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { KAFKA_CLIENT, TOPICS, runWithCorrelation, withDlt, KafkaProducerService, AppLogger } from '@sgd/common';

/**
 * Temporary drain consumer for workflow.* Kafka topics that have no business
 * handler yet.  Its sole purpose is to advance the consumer-group offset so
 * that unprocessed messages do not accumulate infinite lag.
 *
 * Each message is:
 *   1. Parsed as JSON (best-effort).
 *   2. Logged at debug level so events are still visible in observability tooling.
 *   3. Discarded — the offset is committed via withDlt, which never throws.
 *
 * When a real consumer is implemented for a topic, remove that topic from the
 * DRAIN_TOPICS list below and implement a dedicated handler.
 *
 * Consumer group: <KAFKA_CONSUMER_GROUP>-workflow-drain
 * This is intentionally separate from the audit consumer's group so offsets are
 * tracked independently and the existing audit consumer is not affected.
 */

const DRAIN_TOPICS = [
  TOPICS.WORKFLOW_CREATED,
  TOPICS.WORKFLOW_APPROVAL_STARTED,
  TOPICS.WORKFLOW_APPROVAL_APPROVED,
  TOPICS.WORKFLOW_APPROVAL_REJECTED,
  TOPICS.WORKFLOW_APPROVAL_COMPLETED,
  TOPICS.WORKFLOW_RETURNED_TO_CREATOR,
  TOPICS.WORKFLOW_RESUBMITTED,
  TOPICS.WORKFLOW_AVAILABLE_FOR_FINAL_USERS,
  TOPICS.WORKFLOW_ADMIN_CYCLE_STARTED,
  TOPICS.WORKFLOW_ADMIN_CYCLE_STEP_COMPLETED,
  TOPICS.WORKFLOW_ADMIN_CYCLE_COMPLETED,
  TOPICS.WORKFLOW_CLOSED,
  TOPICS.WORKFLOW_CANCELLED,
] as const;

@Injectable()
export class WorkflowEventDrainConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private consumer!: Consumer;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
    private readonly producer: KafkaProducerService,
  ) {}

  async onApplicationBootstrap() {
    const baseGroup = this.config.getOrThrow<string>('KAFKA_CONSUMER_GROUP');
    // Separate group so this drain consumer's offsets are independent of the
    // main audit consumer and can be removed cleanly when real consumers exist.
    const groupId = `${baseGroup}-workflow-drain`;

    this.consumer = this.kafka.consumer({
      groupId,
      retry: { initialRetryTime: 300, retries: 3 },
    });

    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [...DRAIN_TOPICS],
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
              context: 'WorkflowEventDrainConsumer',
            },
            () => this.handleMessage(payload),
          ),
        );
      },
    });

    this.logger.log(
      `Workflow drain consumer connected — draining ${DRAIN_TOPICS.length} topics pending real consumers`,
      'WorkflowEventDrainConsumer',
    );
  }

  async onApplicationShutdown() {
    await this.consumer?.disconnect();
    this.logger.log('Workflow drain consumer disconnected', 'WorkflowEventDrainConsumer');
  }

  private async handleMessage({ topic, message }: EachMessagePayload) {
    if (!message.value) return;

    let workflowId: string | undefined;
    try {
      const parsed = JSON.parse(message.value.toString()) as Record<string, unknown>;
      workflowId = typeof parsed['workflowId'] === 'string' ? parsed['workflowId'] : undefined;
    } catch {
      // Malformed JSON — still advance the offset, just log a warning
      this.logger.warn(
        `[kafka-drain] Malformed JSON in topic ${topic} — discarding`,
        'WorkflowEventDrainConsumer',
      );
      return;
    }

    // Debug-level log so events remain visible in observability tooling without
    // flooding production logs.
    this.logger.debug(
      `[kafka-drain] ← ${topic}${workflowId ? ` workflowId=${workflowId}` : ''} — no handler, offset advanced`,
      'WorkflowEventDrainConsumer',
    );
  }
}

import {
  Injectable, Inject, OnApplicationBootstrap, OnApplicationShutdown,
} from '@nestjs/common';
import { Kafka, Producer } from 'kafkajs';
import { KAFKA_CLIENT } from './kafka.constants';
import { AppLogger } from '../logger/app-logger.service';
import { getCorrelationId } from '../correlation/correlation.context';

@Injectable()
export class KafkaProducerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly producer: Producer;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    private readonly logger: AppLogger,
  ) {
    this.producer = this.kafka.producer();
  }

  async onApplicationBootstrap() {
    await this.producer.connect();
    this.logger.log('Kafka producer connected', 'KafkaProducerService');
  }

  async onApplicationShutdown() {
    await this.producer.disconnect();
    this.logger.log('Kafka producer disconnected', 'KafkaProducerService');
  }

  /** Fire-and-forget: loguea el error pero no lo propaga al caller. */
  emitSafe(topic: string, payload: unknown): void {
    this.emit(topic, payload).catch((err: unknown) => {
      this.logger.error(
        `Failed to emit Kafka event to topic "${topic}": ${err instanceof Error ? err.message : String(err)}`,
        'KafkaProducerService',
      );
    });
  }

  async emit(topic: string, payload: unknown): Promise<void> {
    const correlationId = getCorrelationId();
    this.logger.http({ type: 'kafka-produce', topic, correlationId, message: `→ [kafka] ${topic}` });
    await this.producer.send({
      topic,
      messages: [{
        value:   JSON.stringify(payload),
        headers: { 'x-correlation-id': correlationId, 'content-type': 'application/json' },
      }],
    });
  }
}

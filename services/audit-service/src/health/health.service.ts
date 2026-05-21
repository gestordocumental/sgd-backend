import { Injectable, Inject } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Kafka } from 'kafkajs';
import { KAFKA_CLIENT } from '../common/kafka/kafka.constants';

@Injectable()
export class HealthService {
  constructor(
    private readonly es: ElasticsearchService,
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
  ) {}

  async checkDependencies(): Promise<boolean> {
    try {
      await Promise.all([
        this.es.ping(),
        this.pingKafka(),
      ]);
      return true;
    } catch (err) {
      console.error('Health check dependency failed:', err);
      return false;
    }
  }

  private async pingKafka(): Promise<void> {
    const admin = this.kafka.admin();
    try {
      await admin.connect();
    } finally {
      await admin.disconnect();
    }
  }
}

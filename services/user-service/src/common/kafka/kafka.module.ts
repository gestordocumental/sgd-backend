import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';
import { KafkaProducerService } from './kafka-producer.service';
import { AppLogger } from '../logger/app-logger.service';
import { KAFKA_CLIENT } from './kafka.constants';

/**
 * KafkaModule — configures kafkajs and exposes KafkaProducerService.
 *
 * Import this module in any feature module that needs to produce events.
 * For consumers, use runWithCorrelation() from kafka-consumer.util.ts.
 *
 * Required env vars:
 *   KAFKA_BROKER  — e.g. "kafka.sgd-infra.svc.cluster.local:9092"
 *   KAFKA_CLIENT_ID — e.g. "user-service"
 */
@Module({
  providers: [
    {
      provide: KAFKA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Kafka({
          clientId: config.getOrThrow<string>('KAFKA_CLIENT_ID'),
          brokers:  [config.getOrThrow<string>('KAFKA_BROKER')],
        }),
    },
    KafkaProducerService,
    AppLogger,
  ],
  exports: [KafkaProducerService],
})
export class KafkaModule {}

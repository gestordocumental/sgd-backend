import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';
import { KAFKA_CLIENT } from './kafka.constants';
import { KafkaProducerService } from './kafka-producer.service';
import { AppLogger } from '../logger/app-logger.service';

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
  exports: [KafkaProducerService, KAFKA_CLIENT],
})
export class KafkaModule {}

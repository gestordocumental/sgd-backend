import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';
import { KafkaProducerService } from './kafka-producer.service';
import { AppLogger } from '../logger/app-logger.service';
import { KAFKA_CLIENT } from './kafka.constants';

/**
 * KafkaModule — configura kafkajs y expone KafkaProducerService.
 *
 * Importar en cualquier módulo de dominio que necesite producir eventos.
 *
 * Variables de entorno requeridas:
 *   KAFKA_BROKER     — e.g. "localhost:9094"
 *   KAFKA_CLIENT_ID  — e.g. "workflow-service"
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

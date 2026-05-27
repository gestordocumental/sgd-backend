import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { Kafka } from 'kafkajs';
import { KAFKA_CLIENT } from '../common/kafka/kafka.constants';
import { AppLogger } from '../common/logger/app-logger.service';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditConsumer } from './audit.consumer';

@Module({
  imports: [
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        node: config.getOrThrow<string>('ELASTICSEARCH_URL'),
      }),
    }),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditConsumer,
    AppLogger,
    {
      provide: KAFKA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Kafka({
          clientId: config.getOrThrow<string>('KAFKA_CLIENT_ID'),
          brokers:  [config.getOrThrow<string>('KAFKA_BROKER')],
        }),
    },
  ],
})
export class AuditModule {}

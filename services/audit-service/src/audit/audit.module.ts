import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { Kafka } from 'kafkajs';
import { KAFKA_CLIENT, KafkaProducerService } from '@sgd/common';
import { AppLogger } from '@sgd/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditConsumer } from './audit.consumer';

@Module({
  imports: [
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const username = config.get<string>('ELASTICSEARCH_USERNAME');
        const password = config.get<string>('ELASTICSEARCH_PASSWORD');

        if (Boolean(username) !== Boolean(password)) {
          throw new Error(
            'ELASTICSEARCH_USERNAME and ELASTICSEARCH_PASSWORD must both be set or both be absent',
          );
        }

        return {
          node: config.getOrThrow<string>('ELASTICSEARCH_URL'),
          ...(username && password ? { auth: { username, password } } : {}),
        };
      },
    }),
  ],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditConsumer,
    KafkaProducerService,
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

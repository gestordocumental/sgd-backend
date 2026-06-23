import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { Kafka } from 'kafkajs';
import { KAFKA_CLIENT } from '@sgd/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [
    TerminusModule,
    ElasticsearchModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        node: config.getOrThrow<string>('ELASTICSEARCH_URL'),
      }),
    }),
  ],
  controllers: [HealthController],
  providers: [
    HealthService,
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
export class HealthModule {}

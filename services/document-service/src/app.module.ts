import { Module, MiddlewareConsumer, NestModule, OnModuleInit } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { HealthModule } from './health/health.module';
import { TypologiesModule } from './typologies/typologies.module';
import { BulkImportModule } from './bulk-import/bulk-import.module';
import { DocumentUploadModule } from './document-upload/document-upload.module';
import { WorkflowFilesModule } from './workflow-files/workflow-files.module';
import { KafkaModule } from './common/kafka/kafka.module';
import { KafkaConsumerService } from './common/kafka/kafka-consumer.service';
import { TypologiesService } from './typologies/typologies.service';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware';
import { AppLogger } from './common/logger/app-logger.service';
import { MetricsModule } from './common/metrics/metrics.module';

import { StorageService } from './common/storage/storage.service';
import { KAFKA_CLIENT } from './common/kafka/kafka.constants';
import { ConfigService as CS } from '@nestjs/config';
import { Kafka } from 'kafkajs';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
      }),
    }),

    KafkaModule,
    HealthModule,
    TypologiesModule,
    BulkImportModule,
    DocumentUploadModule,
    WorkflowFilesModule,
    MetricsModule,
  ],
  providers: [
    AppLogger,
    StorageService,
    {
      provide: KafkaConsumerService,
      inject: [KAFKA_CLIENT, ConfigService, AppLogger],
      useFactory: (kafka: Kafka, config: CS, logger: AppLogger) =>
        new KafkaConsumerService(kafka, config, logger),
    },
  ],
  exports: [AppLogger],
})
export class AppModule implements NestModule, OnModuleInit {
  constructor(
    private readonly kafkaConsumer: KafkaConsumerService,
    private readonly typologiesService: TypologiesService,
  ) {}

  onModuleInit() {
    // Wire up Kafka consumer handlers after all providers are initialized
    this.kafkaConsumer.registerHandlers(
      (payload) => this.typologiesService.applyExtractedMetadata(payload.orgId, payload.typologyId, { nombre: payload.nombre, codigo: payload.codigo, version: payload.version }),
      (payload) => this.typologiesService.markExtractionFailed(payload.orgId, payload.typologyId, payload.reason),
    );
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

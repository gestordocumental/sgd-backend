import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Client } from '@elastic/elasticsearch';
import { Kafka } from 'kafkajs';
import { KAFKA_CLIENT, KafkaProducerService } from '@sgd/common';
import { AppLogger } from '@sgd/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditConsumer } from './audit.consumer';
import { ES_WRITE_CLIENT, ES_READ_CLIENT } from './es-client.tokens';

export { ES_WRITE_CLIENT, ES_READ_CLIENT };

/**
 * Builds an ES client for a specific role (WRITE or READ).
 * Role-specific credentials (ELASTICSEARCH_WRITE_* / ELASTICSEARCH_READ_*) take
 * precedence; falls back to the generic ELASTICSEARCH_USERNAME/PASSWORD for
 * backwards compatibility with single-credential deployments.
 *
 * Production setup (Railway):
 *   WRITE user — index:write + indices:admin (Kafka consumer)
 *   READ user  — index:read only             (HTTP audit queries)
 * In local dev both roles can share the elastic superuser.
 */
function buildEsClient(config: ConfigService, role: 'WRITE' | 'READ'): Client {
  const norm = (v?: string): string | undefined => {
    const t = v?.trim();
    return t ? t : undefined;
  };

  const username =
    norm(config.get<string>(`ELASTICSEARCH_${role}_USERNAME`)) ??
    norm(config.get<string>('ELASTICSEARCH_USERNAME'));
  const password =
    norm(config.get<string>(`ELASTICSEARCH_${role}_PASSWORD`)) ??
    norm(config.get<string>('ELASTICSEARCH_PASSWORD'));

  if (Boolean(username) !== Boolean(password)) {
    throw new Error(
      `ELASTICSEARCH ${role.toLowerCase()} credentials must both be set or both absent`,
    );
  }

  return new Client({
    node: config.getOrThrow<string>('ELASTICSEARCH_URL'),
    ...(username && password ? { auth: { username, password } } : {}),
  });
}

@Module({
  imports: [ConfigModule],
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditConsumer,
    KafkaProducerService,
    AppLogger,
    {
      provide: ES_WRITE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildEsClient(config, 'WRITE'),
    },
    {
      provide: ES_READ_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildEsClient(config, 'READ'),
    },
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

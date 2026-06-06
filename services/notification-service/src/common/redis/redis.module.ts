import { Module, Global, Inject, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

function makeRedis(config: ConfigService): Redis {
  const host = config.getOrThrow<string>('REDIS_HOST');
  const rawPort = config.getOrThrow<string>('REDIS_PORT');
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid REDIS_PORT value: "${rawPort}"`);
  }
  return new Redis({
    host,
    port,
    password: config.get<string>('REDIS_PASSWORD') || undefined,
    lazyConnect: false,
  });
}

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => makeRedis(config),
    },
    // Dedicated connection for pub/sub — Redis forbids mixing subscribe commands
    // with regular commands on the same connection.
    {
      provide: 'REDIS_PUBSUB_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => makeRedis(config),
    },
  ],
  exports: ['REDIS_CLIENT', 'REDIS_PUBSUB_CLIENT'],
})
export class RedisModule implements OnModuleDestroy {
  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    @Inject('REDIS_PUBSUB_CLIENT') private readonly pubsub: Redis,
  ) {}

  async onModuleDestroy() {
    await Promise.allSettled([this.redis.quit(), this.pubsub.quit()]);
  }
}

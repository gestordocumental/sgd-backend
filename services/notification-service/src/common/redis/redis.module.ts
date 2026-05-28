import { Module, Global, Inject, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
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
      },
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject('REDIS_CLIENT') private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit();
  }
}

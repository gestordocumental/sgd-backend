import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Global so any module can inject REDIS_CLIENT without importing RedisModule
@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.get<string>('REDIS_HOST'),
          port: config.get<number>('REDIS_PORT'),
          // empty password ("") → undefined so ioredis does not send AUTH
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          lazyConnect: false,
        }),
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}

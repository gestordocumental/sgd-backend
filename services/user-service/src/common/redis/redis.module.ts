import { Module, Global } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

// Global para que cualquier módulo pueda inyectar REDIS_CLIENT sin importar RedisModule
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
          // password vacío ("") → undefined para que ioredis no mande AUTH
          password: config.get<string>('REDIS_PASSWORD') || undefined,
          lazyConnect: false,
        }),
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}

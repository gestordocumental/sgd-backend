import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { Credential } from './auth/entities/credential.entity';
import { AppLogger, CorrelationMiddleware, MetricsModule, JwtGuard } from '@sgd/common';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting per IP, applied globally via APP_GUARD.
    // Internal endpoints opt out with @SkipThrottle().
    // Override via THROTTLE_TTL / THROTTLE_LIMIT env vars (e.g. increase for load-test envs).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const ttl   = Number(config.get<string>('THROTTLE_TTL',   '60000'));
        const limit = Number(config.get<string>('THROTTLE_LIMIT', '10'));
        if (!Number.isFinite(ttl)   || ttl   <= 0) throw new Error(`Invalid THROTTLE_TTL: ${config.get('THROTTLE_TTL')}`);
        if (!Number.isFinite(limit) || limit <= 0) throw new Error(`Invalid THROTTLE_LIMIT: ${config.get('THROTTLE_LIMIT')}`);
        return [{ ttl, limit }];
      },
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbPortRaw = config.get<string>('DB_PORT');
        const dbPort = Number(dbPortRaw);
        if (!Number.isInteger(dbPort) || dbPort <= 0 || dbPort > 65535) {
          throw new Error(`Invalid DB_PORT value: "${dbPortRaw}"`);
        }
        const poolSizeRaw = config.get<string>('DB_POOL_SIZE') ?? '15';
        const poolSize = Number(poolSizeRaw);
        if (!Number.isInteger(poolSize) || poolSize <= 0) {
          throw new Error(`Invalid DB_POOL_SIZE value: "${poolSizeRaw}"`);
        }
        return {
          type: 'postgres',
          host: config.get<string>('DB_HOST'),
          port: dbPort,
          username: config.get<string>('DB_USERNAME'),
          password: config.get<string>('DB_PASSWORD'),
          database: config.get<string>('DB_NAME'),
          entities: [Credential],
          synchronize: false,
          retryAttempts: 5,
          retryDelay: 3000,
          extra: {
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
            idleTimeoutMillis: 60000,       // drop idle connections after 60s; pool will reconnect on next query
            connectionTimeoutMillis: 10000, // fail fast if can't acquire connection within 10s
            max: poolSize,
          },
        };
      },
    }),

    RedisModule,
    AuthModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    AppLogger,
    // Global rate-limiting guard — every endpoint is throttled by default.
    // Use @SkipThrottle() on endpoints that must not be rate-limited (e.g. internal service calls).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Global JWT guard — only activates on endpoints decorated with @Auth(), @OrgMember(), or @SuperAdminOnly().
    // Endpoints without those decorators are allowed through (public).
    { provide: APP_GUARD, useClass: JwtGuard },
  ],
  exports: [AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

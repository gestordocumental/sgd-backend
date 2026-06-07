import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './common/redis/redis.module';
import { CorrelationMiddleware, AppLogger, MetricsModule, JwtGuard } from '@sgd/common';
import { Notification } from './notifications/entities/notification.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

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
          host:     config.get<string>('DB_HOST'),
          port:     dbPort,
          username: config.get<string>('DB_USERNAME'),
          password: config.get<string>('DB_PASSWORD'),
          database: config.get<string>('DB_NAME'),
          entities: [Notification],
          synchronize: false,
          retryAttempts: 5,
          retryDelay: 3000,
          extra: {
            parseInt8: true,
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
            max: poolSize,
          },
        };
      },
    }),

    RedisModule,
    NotificationsModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    AppLogger,
    { provide: APP_GUARD, useClass: JwtGuard },
  ],
  exports: [AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

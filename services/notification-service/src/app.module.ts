import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
import { NotificationsModule } from './notifications/notifications.module';
import { HealthModule } from './health/health.module';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware';
import { AppLogger } from './common/logger/app-logger.service';
import { MetricsModule } from './common/metrics/metrics.module';

import { JwtGuard } from './common/guards/jwt.guard';
import { Notification } from './notifications/entities/notification.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbPort = Number(config.get<string>('DB_PORT'));
        if (!Number.isInteger(dbPort)) {
          throw new Error(`Invalid DB_PORT value: "${config.get('DB_PORT')}"`);
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
          },
        };
      },
    }),

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

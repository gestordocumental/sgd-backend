import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware';
import { AppLogger } from './common/logger/app-logger.service';
import { MetricsModule } from './common/metrics/metrics.module';

import { JwtGuard } from './common/guards/jwt.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuditModule,
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

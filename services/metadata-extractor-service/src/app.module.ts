import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { ExtractorModule } from './extractor/extractor.module';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware';
import { AppLogger } from './common/logger/app-logger.service';
import { MetricsModule } from './common/metrics/metrics.module';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    HealthModule,
    ExtractorModule,
    MetricsModule,
  ],
  providers: [AppLogger],
  exports: [AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrgsModule } from './orgs/orgs.module';
import { HealthModule } from './health/health.module';
import { Org } from './orgs/entities/org.entity';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware';
import { AppLogger } from './common/logger/app-logger.service';

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
          host: config.get<string>('DB_HOST'),
          port: dbPort,
          username: config.get<string>('DB_USERNAME'),
          password: config.get<string>('DB_PASSWORD'),
          database: config.get<string>('DB_NAME'),
          entities: [Org],
          synchronize: false,
          retryAttempts: 5,
          retryDelay: 3000,
        };
      },
    }),

    OrgsModule,
    HealthModule,
  ],
  providers: [AppLogger],
  exports: [AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

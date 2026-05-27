import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { Credential } from './auth/entities/credential.entity';
import { AppLogger, CorrelationMiddleware, MetricsModule } from '@sgd/common';


@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    // Rate limiting: máx 10 intentos por IP en una ventana de 60 segundos.
    // Aplicado selectivamente en los endpoints de autenticación.
    ThrottlerModule.forRoot([{
      ttl: 60_000,
      limit: 10,
    }]),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST'),
        port: config.get<number>('DB_PORT'),
        username: config.get<string>('DB_USERNAME'),
        password: config.get<string>('DB_PASSWORD'),
        database: config.get<string>('DB_NAME'),
        entities: [Credential],
        // synchronize solo en desarrollo — en prod usar migraciones
        synchronize: config.get('NODE_ENV') === 'development',
        retryAttempts: 5,
        retryDelay: 3000,
        extra: {
          keepAlive: true,
          keepAliveInitialDelayMillis: 10000,
        },
      }),
    }),

    RedisModule,
    AuthModule,
    HealthModule,
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

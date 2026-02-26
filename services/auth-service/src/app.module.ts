import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';
import { Credential } from './auth/entities/credential.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

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
      }),
    }),

    RedisModule,
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}

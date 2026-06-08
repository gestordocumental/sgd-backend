import { Module, MiddlewareConsumer, NestModule, Inject } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Redis } from 'ioredis';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { HealthModule } from './health/health.module';
import { User } from './users/entities/user.entity';
import { Role } from './roles/entities/role.entity';
import { Permission } from './roles/entities/permission.entity';
import { UserOrgRole } from './roles/entities/user-org-role.entity';
import { CorrelationMiddleware, AppLogger, MetricsModule, SUPER_ADMIN_REVOCATION_CHECKER } from '@sgd/common';

import { RedisModule } from './common/redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const dbPortRaw = config.get<string>('DB_PORT') ?? '5432';
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
          entities: [User, Role, Permission, UserOrgRole],
          synchronize: false,
          retryAttempts: 5,
          retryDelay: 3000,
          extra: {
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
            max: poolSize,
          },
        };
      },
    }),

    RedisModule,
    UsersModule,
    RolesModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    AppLogger,
    {
      provide: SUPER_ADMIN_REVOCATION_CHECKER,
      inject: ['REDIS_CLIENT'],
      useFactory: (redis: Redis) => async (userId: string): Promise<boolean> => {
        const val = await redis.get(`sa-revoked:${userId}`);
        return val !== null;
      },
    },
  ],
  exports: [AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply correlation middleware to all routes
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

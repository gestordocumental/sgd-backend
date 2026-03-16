import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { RolesModule } from './roles/roles.module';
import { HealthModule } from './health/health.module';
import { User } from './users/entities/user.entity';
import { Role } from './roles/entities/role.entity';
import { Permission } from './roles/entities/permission.entity';
import { UserOrgRole } from './roles/entities/user-org-role.entity';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware';
import { AppLogger } from './common/logger/app-logger.service';
import { RedisModule } from './common/redis/redis.module';

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
          entities: [User, Role, Permission, UserOrgRole],
          synchronize: config.get('NODE_ENV') === 'development',
          retryAttempts: 5,
          retryDelay: 3000,
        };
      },
    }),

    RedisModule,
    UsersModule,
    RolesModule,
    HealthModule,
  ],
  providers: [AppLogger],
  exports: [AppLogger],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply correlation middleware to all routes
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

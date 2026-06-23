import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrgsModule } from './orgs/orgs.module';
import { OrgStructureModule } from './org-structure/org-structure.module';
import { HealthModule } from './health/health.module';
import { Org } from './orgs/entities/org.entity';
import { Departamento } from './org-structure/entities/departamento.entity';
import { Area } from './org-structure/entities/area.entity';
import { Cargo } from './org-structure/entities/cargo.entity';
import { CorrelationMiddleware, AppLogger, MetricsModule } from '@sgd/common';


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
          host: config.get<string>('DB_HOST'),
          port: dbPort,
          username: config.get<string>('DB_USERNAME'),
          password: config.get<string>('DB_PASSWORD'),
          database: config.get<string>('DB_NAME'),
          entities: [Org, Departamento, Area, Cargo],
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

    OrgsModule,
    OrgStructureModule,
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

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
            // Postgres has no default lock_timeout, so a SELECT ... FOR UPDATE/FOR
            // SHARE (see AreasService/DepartamentosService/CargosService's
            // race-condition locking) would otherwise wait indefinitely if it
            // collides with another transaction's lock on the same row — hanging
            // the request instead of failing fast with a clear error (Postgres
            // 55P03). Passed as a libpq startup option, applied to every
            // connection the pool opens.
            options: '-c lock_timeout=5000',
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

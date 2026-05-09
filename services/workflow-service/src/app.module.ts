import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { APP_GUARD } from '@nestjs/core';
import { WorkflowsModule } from './workflows/workflows.module';
import { HealthModule } from './health/health.module';
import { CorrelationMiddleware } from './common/middleware/correlation.middleware';
import { AppLogger } from './common/logger/app-logger.service';
import { JwtGuard } from './common/guards/jwt.guard';

// Entities — registradas en TypeOrmModule para que el guard y los repositorios las encuentren
import { Workflow } from './workflows/entities/workflow.entity';
import { WorkflowApprovalStep } from './workflows/entities/workflow-approval-step.entity';
import { WorkflowApprovalAction } from './workflows/entities/workflow-approval-action.entity';
import { WorkflowAttachment } from './workflows/entities/workflow-attachment.entity';
import { WorkflowAdminCycle } from './workflows/entities/workflow-admin-cycle.entity';
import { WorkflowAdminStep } from './workflows/entities/workflow-admin-step.entity';
import { WorkflowAdminAttachment } from './workflows/entities/workflow-admin-attachment.entity';
import { WorkflowNote } from './workflows/entities/workflow-note.entity';
import { WorkflowTimeline } from './workflows/entities/workflow-timeline.entity';

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
          entities: [
            Workflow,
            WorkflowApprovalStep,
            WorkflowApprovalAction,
            WorkflowAttachment,
            WorkflowAdminCycle,
            WorkflowAdminStep,
            WorkflowAdminAttachment,
            WorkflowNote,
            WorkflowTimeline,
          ],
          synchronize: false,
          retryAttempts: 5,
          retryDelay: 3000,
          extra: { parseInt8: true },
        };
      },
    }),

    // HttpModule global para DocumentClientService y UserClientService
    HttpModule.register({ timeout: 5000 }),

    WorkflowsModule,
    HealthModule,
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

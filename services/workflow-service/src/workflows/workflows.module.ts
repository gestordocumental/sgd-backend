import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowApprovalService } from './workflow-approval.service';
import { WorkflowAdminCycleService } from './workflow-admin-cycle.service';
import { WorkflowTimelineService } from './workflow-timeline.service';

import { Workflow } from './entities/workflow.entity';
import { WorkflowApprovalStep } from './entities/workflow-approval-step.entity';
import { WorkflowApprovalAction } from './entities/workflow-approval-action.entity';
import { WorkflowAttachment } from './entities/workflow-attachment.entity';
import { WorkflowAdminCycle } from './entities/workflow-admin-cycle.entity';
import { WorkflowAdminStep } from './entities/workflow-admin-step.entity';
import { WorkflowAdminAttachment } from './entities/workflow-admin-attachment.entity';
import { WorkflowNote } from './entities/workflow-note.entity';
import { WorkflowTimeline } from './entities/workflow-timeline.entity';

import { KafkaModule } from '../common/kafka/kafka.module';
import { DocumentClientService } from '../common/clients/document-client.service';
import { UserClientService } from '../common/clients/user-client.service';
import { AppLogger } from '../common/logger/app-logger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Workflow,
      WorkflowApprovalStep,
      WorkflowApprovalAction,
      WorkflowAttachment,
      WorkflowAdminCycle,
      WorkflowAdminStep,
      WorkflowAdminAttachment,
      WorkflowNote,
      WorkflowTimeline,
    ]),
    HttpModule,
    KafkaModule,
  ],
  controllers: [WorkflowsController],
  providers: [
    WorkflowsService,
    WorkflowApprovalService,
    WorkflowAdminCycleService,
    WorkflowTimelineService,
    DocumentClientService,
    UserClientService,
    AppLogger,
  ],
})
export class WorkflowsModule {}

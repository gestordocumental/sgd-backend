import { Module } from '@nestjs/common';
import { WorkflowFilesController } from './workflow-files.controller';
import { WorkflowFilesService } from './workflow-files.service';
import { StorageService } from '../common/storage/storage.service';
import { AppLogger } from '@sgd/common';

@Module({
  controllers: [WorkflowFilesController],
  providers: [WorkflowFilesService, StorageService, AppLogger],
})
export class WorkflowFilesModule {}

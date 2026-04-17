import { Module } from '@nestjs/common';
import { BulkImportService } from './bulk-import.service';
import { BulkImportController } from './bulk-import.controller';
import { TypologiesModule } from '../typologies/typologies.module';
import { OrgClientModule } from '../common/org-client/org-client.module';
import { AppLogger } from '../common/logger/app-logger.service';

@Module({
  imports: [TypologiesModule, OrgClientModule],
  controllers: [BulkImportController],
  providers: [BulkImportService, AppLogger],
})
export class BulkImportModule {}

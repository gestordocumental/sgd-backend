import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OrgClientService } from './org-client.service';
import { AppLogger } from '../logger/app-logger.service';

@Module({
  imports: [HttpModule],
  providers: [OrgClientService, AppLogger],
  exports: [OrgClientService],
})
export class OrgClientModule {}

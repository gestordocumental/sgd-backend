import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OrgClientService } from './org-client.service';
import { AppLogger } from '@sgd/common';

@Module({
  imports: [HttpModule],
  providers: [OrgClientService, AppLogger],
  exports: [OrgClientService],
})
export class OrgClientModule {}

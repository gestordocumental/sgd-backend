import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { OrgClientService } from './org-client.service';
import { AppLogger } from '@sgd/common';

@Module({
  imports: [
    HttpModule.register({
      timeout: 10000,  // must exceed timeoutMs in OrgClientService (5s) so RxJS timeout always fires first
      maxRedirects: 0,
    }),
  ],
  providers: [OrgClientService, AppLogger],
  exports: [OrgClientService],
})
export class OrgClientModule {}

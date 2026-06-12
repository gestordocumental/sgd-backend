import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { UserClientService } from './user-client.service';
import { AppLogger } from '@sgd/common';

@Module({
  imports: [
    HttpModule.register({
      timeout: 20000,  // must exceed timeoutMs in UserClientService (15s) so RxJS timeout always fires first
      maxRedirects: 0,
    }),
  ],
  providers: [UserClientService, AppLogger],
  exports: [UserClientService],
})
export class UserClientModule {}

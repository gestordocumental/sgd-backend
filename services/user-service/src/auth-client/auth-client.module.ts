import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AuthClientService } from './auth-client.service';
import { AppLogger } from '@sgd/common';

@Module({
  imports: [
    HttpModule.register({
      timeout: 20000,  // must exceed timeoutMs in AuthClientService (15s) so RxJS timeout always fires first
      maxRedirects: 0,
    }),
  ],
  providers: [AuthClientService, AppLogger],
  exports: [AuthClientService],
})
export class AuthClientModule {}

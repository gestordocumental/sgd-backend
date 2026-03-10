import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { UserClientService } from './user-client.service';
import { AppLogger } from '../common/logger/app-logger.service';

@Module({
  imports: [
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 0,
    }),
  ],
  providers: [UserClientService, AppLogger],
  exports: [UserClientService],
})
export class UserClientModule {}

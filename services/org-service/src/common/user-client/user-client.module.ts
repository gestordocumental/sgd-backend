import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { UserClientService } from './user-client.service';

@Module({
  imports: [HttpModule],
  providers: [UserClientService],
  exports: [UserClientService],
})
export class UserClientModule {}

import { Module } from '@nestjs/common';
import { ClamavService } from './clamav.service';
import { AppLogger } from '@sgd/common';

@Module({
  providers: [ClamavService, AppLogger],
  exports: [ClamavService],
})
export class ClamavModule {}

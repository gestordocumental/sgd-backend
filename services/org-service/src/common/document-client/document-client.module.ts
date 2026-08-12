import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DocumentClientService } from './document-client.service';
import { AppLogger } from '@sgd/common';

@Module({
  imports: [HttpModule],
  providers: [DocumentClientService, AppLogger],
  exports: [DocumentClientService],
})
export class DocumentClientModule {}

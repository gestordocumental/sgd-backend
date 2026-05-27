import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ExtractorClientService } from './extractor-client.service';
import { AppLogger } from '@sgd/common';

@Module({
  imports: [HttpModule],
  providers: [ExtractorClientService, AppLogger],
  exports: [ExtractorClientService],
})
export class ExtractorClientModule {}

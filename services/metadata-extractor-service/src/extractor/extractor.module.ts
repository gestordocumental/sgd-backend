import { Module } from '@nestjs/common';
import { KafkaModule, AppLogger } from '@sgd/common';
import { StorageService } from '../common/storage/storage.service';
import { MetadataRulesService } from './rules/metadata-rules.service';
import { ExtractorService } from './extractor.service';
import { PreviewExtractController } from './preview-extract.controller';

@Module({
  imports: [KafkaModule],
  controllers: [PreviewExtractController],
  providers: [ExtractorService, StorageService, MetadataRulesService, AppLogger],
})
export class ExtractorModule {}

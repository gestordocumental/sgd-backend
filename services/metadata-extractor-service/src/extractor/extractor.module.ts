import { Module } from '@nestjs/common';
import { KafkaModule } from '../common/kafka/kafka.module';
import { StorageService } from '../common/storage/storage.service';
import { MetadataRulesService } from './rules/metadata-rules.service';
import { ExtractorService } from './extractor.service';
import { AppLogger } from '../common/logger/app-logger.service';

@Module({
  imports: [KafkaModule],
  providers: [ExtractorService, StorageService, MetadataRulesService, AppLogger],
})
export class ExtractorModule {}

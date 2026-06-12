import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Typology, TypologySchema } from '../typologies/schemas/typology.schema';
import { DocumentUploadService } from './document-upload.service';
import { DocumentUploadController } from './document-upload.controller';
import { AppLogger, KafkaModule } from '@sgd/common';
import { StorageService } from '../common/storage/storage.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Typology.name, schema: TypologySchema }]),
    KafkaModule,
  ],
  controllers: [DocumentUploadController],
  providers: [DocumentUploadService, StorageService, AppLogger],
})
export class DocumentUploadModule {}

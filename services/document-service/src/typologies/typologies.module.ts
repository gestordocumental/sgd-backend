import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Typology, TypologySchema } from './schemas/typology.schema';
import { TypologiesService } from './typologies.service';
import { TypologiesController } from './typologies.controller';
import { InternalTypologiesController } from './internal-typologies.controller';
import { OrgClientModule } from '../common/org-client/org-client.module';
import { ExtractorClientModule } from '../common/extractor-client/extractor-client.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Typology.name, schema: TypologySchema }]),
    OrgClientModule,
    ExtractorClientModule,
  ],
  controllers: [TypologiesController, InternalTypologiesController],
  providers: [TypologiesService],
  exports: [TypologiesService],
})
export class TypologiesModule {}

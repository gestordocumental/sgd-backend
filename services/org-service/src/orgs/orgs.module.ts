import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Org } from './entities/org.entity';
import { OrgsService } from './orgs.service';
import { OrgsController } from './orgs.controller';
import { OrgGuard } from '../common/guards/org.guard';
import { KafkaModule } from '@sgd/common';

@Module({
  imports: [TypeOrmModule.forFeature([Org]), KafkaModule],
  controllers: [OrgsController],
  providers: [OrgsService, OrgGuard],
  exports: [OrgsService],
})
export class OrgsModule {}

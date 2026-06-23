import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Org } from './entities/org.entity';
import { OrgsService } from './orgs.service';
import { OrgsController } from './orgs.controller';
import { OrgGuard } from '../common/guards/org.guard';
import { KafkaModule } from '@sgd/common';
import { UserClientService } from '../common/user-client/user-client.service';

@Module({
  imports: [TypeOrmModule.forFeature([Org]), KafkaModule, HttpModule],
  controllers: [OrgsController],
  providers: [OrgsService, OrgGuard, UserClientService],
  exports: [OrgsService],
})
export class OrgsModule {}

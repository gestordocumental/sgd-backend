import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Org } from './entities/org.entity';
import { OrgsService } from './orgs.service';
import { OrgsController } from './orgs.controller';
import { InternalOrgsController } from './internal-orgs.controller';
import { OrgGuard } from '../common/guards/org.guard';
import { KafkaModule, InternalGuard } from '@sgd/common';
import { UserClientModule } from '../common/user-client/user-client.module';

@Module({
  imports: [TypeOrmModule.forFeature([Org]), KafkaModule, UserClientModule],
  controllers: [OrgsController, InternalOrgsController],
  providers: [OrgsService, OrgGuard, InternalGuard],
  exports: [OrgsService],
})
export class OrgsModule {}

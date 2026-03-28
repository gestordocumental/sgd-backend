import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Org } from './entities/org.entity';
import { OrgsService } from './orgs.service';
import { OrgsController } from './orgs.controller';
import { OrgGuard } from '../common/guards/org.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Org])],
  controllers: [OrgsController],
  providers: [OrgsService, OrgGuard],
  exports: [OrgsService],
})
export class OrgsModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { UserOrgRole } from './entities/user-org-role.entity';
import { RolesService } from './roles.service';
import { PermissionsService } from './permissions.service';
import { PermissionsSeeder } from './permissions.seeder';
import { RolesController } from './roles.controller';
import { PermissionsController } from './permissions.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission, UserOrgRole])],
  controllers: [RolesController, PermissionsController],
  providers: [RolesService, PermissionsService, PermissionsSeeder],
  exports: [RolesService, PermissionsService],
})
export class RolesModule {}

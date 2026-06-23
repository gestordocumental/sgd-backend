import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { UserProfileService } from './user-profile.service';
import { UserOrgService } from './user-org.service';
import { UserRegistrationService } from './user-registration.service';
import { UsersController } from './users.controller';
import { InternalUsersController } from './internal-users.controller';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';
import { Role } from '../roles/entities/role.entity';
import { KafkaModule, InternalGuard } from '@sgd/common';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { SuperAdminSeeder } from './super-admin.seeder';
import { StorageModule } from '../common/storage/storage.module';
import { OrgClientModule } from '../common/org-client/org-client.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserOrgRole, Role]),
    AuthClientModule,
    KafkaModule,
    StorageModule,
    OrgClientModule,
  ],
  controllers: [UsersController, InternalUsersController],
  providers: [
    UserProfileService,
    UserOrgService,
    UserRegistrationService,
    UsersService,
    PermissionsGuard,
    SuperAdminSeeder,
    InternalGuard,
  ],
  exports: [UsersService],
})
export class UsersModule {}

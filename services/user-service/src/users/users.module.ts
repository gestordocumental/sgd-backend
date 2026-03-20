import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';
import { KafkaModule } from '../common/kafka/kafka.module';
import { PermissionsGuard } from '../common/guards/permissions.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserOrgRole]),
    AuthClientModule,
    KafkaModule,
  ],
  controllers: [UsersController],
  providers: [UsersService, PermissionsGuard],
  exports: [UsersService],
})
export class UsersModule {}

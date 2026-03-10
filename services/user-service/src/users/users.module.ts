import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthClientModule } from '../auth-client/auth-client.module';
import { UserOrgRole } from '../roles/entities/user-org-role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserOrgRole]),
    AuthClientModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

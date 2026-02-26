import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Credential } from './entities/credential.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Credential]),
    // Configuración dinámica: el service pasa secret/expiresIn en cada .sign()
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}

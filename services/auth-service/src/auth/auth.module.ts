import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { Credential } from "./entities/credential.entity";
import { UserClientModule } from "../user-client/user-client.module";
import { CredentialSeeder } from "./credential.seeder";

@Module({
  imports: [
    TypeOrmModule.forFeature([Credential]),
    // Dynamic config: the service passes secret/expiresIn in each .sign()
    JwtModule.register({}),
    UserClientModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, CredentialSeeder],
})
export class AuthModule {}

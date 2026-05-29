import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { Credential } from "./entities/credential.entity";
import { UserClientModule } from "../user-client/user-client.module";
import { CredentialSeeder } from "./credential.seeder";
import { AppLogger, KafkaModule } from "@sgd/common";

@Module({
  imports: [
    TypeOrmModule.forFeature([Credential]),
    // Dynamic config: the service passes secret/expiresIn in each .sign()
    JwtModule.register({}),
    UserClientModule,
    KafkaModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, CredentialSeeder, AppLogger],
})
export class AuthModule {}

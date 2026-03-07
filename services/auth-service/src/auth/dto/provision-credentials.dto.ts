import { IsEmail, IsString, MinLength, IsUUID } from "class-validator";

export class ProvisionCredentialDto {
  @IsUUID()
  userId!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}

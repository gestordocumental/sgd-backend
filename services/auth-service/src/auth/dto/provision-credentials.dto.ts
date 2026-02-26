import {
  IsEmail,
  IsString,
  MinLength,
  IsUUID,
} from "class-validator";

export class ProvisionCredentialDto {
  @IsUUID()
  companyId: string;

  @IsUUID()
  userId: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;
}

import { IsEmail, IsString, MinLength, IsUUID } from "class-validator";
import { ApiProperty } from '@nestjs/swagger';

export class ProvisionCredentialDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890', format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 'usuario@empresa.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'P@ssword1', minLength: 8 })
  @IsString()
  @MinLength(8)
  password!: string;
}

import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateUserDto {
  @Transform(({ value }) => (value as string)?.toLowerCase().trim())
  @IsEmail()
  email!: string;

  // Required at creation — identifies the user's role in the company
  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsNotEmpty()
  position!: string;

  @IsBoolean()
  @IsOptional()
  isSuperAdmin?: boolean;

  // If provided, the user is automatically assigned the ADMIN role in this org
  @IsUUID()
  @IsOptional()
  orgId?: string;

  // If provided alongside orgId, overrides the default ADMIN role assignment
  @IsUUID()
  @IsOptional()
  roleId?: string;
}

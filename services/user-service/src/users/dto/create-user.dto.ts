import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateUserDto {
  @Transform(({ value }) => (value as string)?.toLowerCase().trim())
  @IsEmail()
  email!: string;

  // Replaced by departamento/area/cargo structure — kept for backward compatibility
  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsOptional()
  position?: string;

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

  // Org-structure assignment (plain UUID references — cross-service, no FK)
  @IsUUID()
  @IsOptional()
  departamentoId?: string;

  @IsUUID()
  @IsOptional()
  areaId?: string;

  @IsUUID()
  @IsOptional()
  cargoId?: string;
}

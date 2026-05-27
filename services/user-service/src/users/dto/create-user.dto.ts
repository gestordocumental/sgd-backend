import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'usuario@empresa.com' })
  @Transform(({ value }) => (value as string)?.toLowerCase().trim())
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ description: 'Legacy position field (use cargoId instead)' })
  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsOptional()
  position?: string;

  @ApiPropertyOptional({ default: false })
  @IsBoolean()
  @IsOptional()
  isSuperAdmin?: boolean;

  @ApiPropertyOptional({ format: 'uuid', description: 'Assigns user to this org with ADMIN role' })
  @IsUUID()
  @IsOptional()
  orgId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Overrides default ADMIN role when orgId is provided' })
  @IsUUID()
  @IsOptional()
  roleId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  departamentoId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  areaId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  cargoId?: string;
}

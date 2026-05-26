import { IsString, IsOptional, IsBoolean, IsUUID, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value as string)?.toUpperCase().trim())
  @IsString()
  @IsOptional()
  idNumber?: string;

  @ApiPropertyOptional()
  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsOptional()
  position?: string;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiPropertyOptional({ description: 'Marca al usuario como revisor opcional en ciclos administrativos de workflows' })
  @IsBoolean()
  @IsOptional()
  isOptionalReviewer?: boolean;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((o) => o.departamentoId !== null)
  @IsUUID()
  @IsOptional()
  departamentoId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((o) => o.areaId !== null)
  @IsUUID()
  @IsOptional()
  areaId?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @ValidateIf((o) => o.cargoId !== null)
  @IsUUID()
  @IsOptional()
  cargoId?: string | null;
}

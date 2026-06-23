import { Transform, Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateNested } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResolveStructureItemDto {
  @ApiProperty({ example: 'Talento Humano' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  department!: string;

  @ApiPropertyOptional({ example: 'Nomina' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  area?: string;

  @ApiPropertyOptional({ example: 'Analista de Nomina' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  position?: string;
}

export class ResolveStructureRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orgId!: string;

  @ApiProperty({ type: [ResolveStructureItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ResolveStructureItemDto)
  items!: ResolveStructureItemDto[];
}

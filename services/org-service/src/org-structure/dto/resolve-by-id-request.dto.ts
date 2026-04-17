import { IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ResolveByIdRequestDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orgId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  departamentoId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  areaId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  cargoId?: string;
}

export class ResolveByIdResponseDto {
  departamentoId!: string;
  departamentoNombre!: string;
  areaId!: string | null;
  areaNombre!: string | null;
  cargoId!: string | null;
  cargoNombre!: string | null;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Area } from '../entities/area.entity';

export class AreaResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orgId!: string;

  @ApiProperty({ format: 'uuid' })
  departamentoId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(a: Area): AreaResponseDto {
    const dto = new AreaResponseDto();
    dto.id = a.id;
    dto.orgId = a.orgId;
    dto.departamentoId = a.departamentoId;
    dto.name = a.name;
    dto.description = a.description;
    dto.createdAt = a.createdAt;
    dto.updatedAt = a.updatedAt;
    return dto;
  }
}

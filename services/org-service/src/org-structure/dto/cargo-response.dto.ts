import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Cargo } from '../entities/cargo.entity';

export class CargoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orgId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  areaId!: string | null;

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

  static from(c: Cargo): CargoResponseDto {
    const dto = new CargoResponseDto();
    dto.id = c.id;
    dto.orgId = c.orgId;
    dto.areaId = c.areaId;
    dto.departamentoId = c.departamentoId;
    dto.name = c.name;
    dto.description = c.description;
    dto.createdAt = c.createdAt;
    dto.updatedAt = c.updatedAt;
    return dto;
  }
}

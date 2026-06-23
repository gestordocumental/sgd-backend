import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Departamento } from '../entities/departamento.entity';

export class DepartamentoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orgId!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  description!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(d: Departamento): DepartamentoResponseDto {
    const dto = new DepartamentoResponseDto();
    dto.id = d.id;
    dto.orgId = d.orgId;
    dto.name = d.name;
    dto.description = d.description;
    dto.createdAt = d.createdAt;
    dto.updatedAt = d.updatedAt;
    return dto;
  }
}

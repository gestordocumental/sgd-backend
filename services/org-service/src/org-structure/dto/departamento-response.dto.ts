import { Departamento } from '../entities/departamento.entity';

export class DepartamentoResponseDto {
  id!: string;
  orgId!: string;
  name!: string;
  description!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static from(d: Departamento): DepartamentoResponseDto {
    const dto = new DepartamentoResponseDto();
    dto.id          = d.id;
    dto.orgId       = d.orgId;
    dto.name        = d.name;
    dto.description = d.description;
    dto.createdAt   = d.createdAt;
    dto.updatedAt   = d.updatedAt;
    return dto;
  }
}

import { Area } from '../entities/area.entity';

export class AreaResponseDto {
  id!: string;
  orgId!: string;
  departamentoId!: string;
  name!: string;
  description!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static from(a: Area): AreaResponseDto {
    const dto = new AreaResponseDto();
    dto.id              = a.id;
    dto.orgId           = a.orgId;
    dto.departamentoId  = a.departamentoId;
    dto.name            = a.name;
    dto.description     = a.description;
    dto.createdAt       = a.createdAt;
    dto.updatedAt       = a.updatedAt;
    return dto;
  }
}

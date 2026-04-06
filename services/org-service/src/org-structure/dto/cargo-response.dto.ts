import { Cargo } from '../entities/cargo.entity';

export class CargoResponseDto {
  id!: string;
  orgId!: string;
  areaId!: string;
  departamentoId!: string;
  name!: string;
  description!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static from(c: Cargo): CargoResponseDto {
    const dto = new CargoResponseDto();
    dto.id              = c.id;
    dto.orgId           = c.orgId;
    dto.areaId          = c.areaId;
    dto.departamentoId  = c.departamentoId;
    dto.name            = c.name;
    dto.description     = c.description;
    dto.createdAt       = c.createdAt;
    dto.updatedAt       = c.updatedAt;
    return dto;
  }
}

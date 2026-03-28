import { Org, OrgStatus } from '../entities/org.entity';

export class OrgResponseDto {
  id!: string;
  name!: string;
  nit!: string | null;
  address!: string | null;
  phone!: string | null;
  status!: OrgStatus;
  createdBy!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static from(org: Org): OrgResponseDto {
    const dto = new OrgResponseDto();
    dto.id        = org.id;
    dto.name      = org.name;
    dto.nit       = org.nit;
    dto.address   = org.address;
    dto.phone     = org.phone;
    dto.status    = org.status;
    dto.createdBy = org.createdBy;
    dto.createdAt = org.createdAt;
    dto.updatedAt = org.updatedAt;
    return dto;
  }
}

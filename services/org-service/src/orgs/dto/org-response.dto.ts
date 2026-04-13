import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Org, OrgStatus } from '../entities/org.entity';

export class OrgResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  nit!: string | null;

  @ApiPropertyOptional({ nullable: true })
  address!: string | null;

  @ApiPropertyOptional({ nullable: true })
  phone!: string | null;

  @ApiProperty({ enum: OrgStatus })
  status!: OrgStatus;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  createdBy!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static from(org: Org): OrgResponseDto {
    const dto = new OrgResponseDto();
    dto.id = org.id;
    dto.name = org.name;
    dto.nit = org.nit;
    dto.address = org.address;
    dto.phone = org.phone;
    dto.status = org.status;
    dto.createdBy = org.createdBy;
    dto.createdAt = org.createdAt;
    dto.updatedAt = org.updatedAt;
    return dto;
  }
}

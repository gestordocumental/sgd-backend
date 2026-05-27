import { IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AssignOrgDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  orgId!: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Role to assign in this org (defaults to VIEWER)' })
  @IsOptional()
  @IsUUID()
  roleId?: string;
}

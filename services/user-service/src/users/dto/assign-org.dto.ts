import { IsOptional, IsUUID } from 'class-validator';

export class AssignOrgDto {
  @IsUUID()
  orgId!: string;

  @IsOptional()
  @IsUUID()
  roleId?: string;
}

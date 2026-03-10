import { IsUUID } from 'class-validator';

export class AssignOrgDto {
  @IsUUID()
  orgId!: string;

  @IsUUID()
  roleId!: string;
}

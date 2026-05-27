import { IsBoolean } from "class-validator";
import { ApiProperty } from '@nestjs/swagger';

export class SetSuperAdminDto {
  @ApiProperty({ description: 'Set to true to grant super admin, false to revoke' })
  @IsBoolean()
  enabled!: boolean;
}
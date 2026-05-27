import { IsArray, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignPermissionsDto {
  @ApiProperty({ type: [String], format: 'uuid', description: 'Permission UUIDs — replaces all existing permissions on the role' })
  @IsArray()
  @IsUUID('4', { each: true })
  permissionIds!: string[];
}

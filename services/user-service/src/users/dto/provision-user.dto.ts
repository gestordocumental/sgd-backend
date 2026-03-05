import { IsUUID, IsString, MinLength } from 'class-validator';

export class ProvisionUserDto {
  // The organization this user belongs to
  @IsUUID()
  companyId: string;

  // Initial password set by admin — user should change on first login
  @IsString()
  @MinLength(8)
  password: string;
}

import { IsUUID, IsString, MinLength, Matches } from 'class-validator';

export class ProvisionUserDto {
  // The organization this user belongs to
  @IsUUID()
  companyId: string;

  // Initial password set by admin — user should change on first login
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/^\S+$/, { message: 'Password must not contain spaces' })
  @Matches(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  @Matches(/[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/, { message: 'Password must contain at least one special character' })
  @Matches(/^(?!.*(?:012|123|234|345|456|567|678|789|890))[\s\S]*$/, { message: 'Password must not contain consecutive numbers (e.g. 123, 456)' })
  password: string;
}

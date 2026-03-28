import { IsString, IsNotEmpty, IsOptional, MinLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

export class CompleteRegistrationDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  @IsString()
  @IsOptional()
  idNumber?: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/^\S+$/, { message: 'Password must not contain spaces' })
  @Matches(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  @Matches(/[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/, { message: 'Password must contain at least one special character' })
  @Matches(/^(?!.*(?:012|123|234|345|456|567|678|789|890))[\s\S]*$/, { message: 'Password must not contain consecutive numbers (e.g. 123, 456)' })
  password!: string;
}

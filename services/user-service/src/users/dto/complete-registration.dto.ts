import { IsString, IsNotEmpty, IsOptional, MinLength, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CompleteRegistrationDto {
  @ApiProperty({ description: 'Invitation token sent by email' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'Juan' })
  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @ApiProperty({ example: 'García' })
  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @ApiPropertyOptional({ example: '1234567890' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase().trim() : value))
  @IsString()
  @IsOptional()
  idNumber?: string;

  @ApiProperty({ description: 'Min 8 chars, at least one uppercase, one special character, no consecutive numbers', example: 'P@ssword1' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  @Matches(/^\S+$/, { message: 'Password must not contain spaces' })
  @Matches(/[A-Z]/, { message: 'Password must contain at least one uppercase letter' })
  // eslint-disable-next-line no-useless-escape
  @Matches(/[!@#$%^&*()\-_=+\[\]{};:'",.<>/?\\|`~]/, { message: 'Password must contain at least one special character' })
  @Matches(/^(?!.*(?:012|123|234|345|456|567|678|789|890))[\s\S]*$/, { message: 'Password must not contain consecutive numbers (e.g. 123, 456)' })
  password!: string;
}

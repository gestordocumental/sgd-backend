import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateUserDto {
  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsOptional()
  firstName?: string;

  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsOptional()
  lastName?: string;

  @Transform(({ value }) => (value as string)?.toUpperCase().trim())
  @IsString()
  @IsOptional()
  idNumber?: string;

  @Transform(({ value }) => (value as string)?.trim())
  @IsString()
  @IsOptional()
  position?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

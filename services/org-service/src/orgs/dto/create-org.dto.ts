import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
} from 'class-validator';

export class CreateOrgDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  nit?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}

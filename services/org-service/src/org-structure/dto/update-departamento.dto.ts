import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

export class UpdateDepartamentoDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

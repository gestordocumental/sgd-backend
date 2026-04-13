import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDepartamentoDto {
  @ApiProperty({ example: 'Talento Humano', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Gestión del talento humano de la empresa' })
  @IsOptional()
  @IsString()
  description?: string;
}

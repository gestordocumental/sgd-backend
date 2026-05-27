import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAreaDto {
  @ApiProperty({ example: 'Nómina', maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Procesamiento de nómina y liquidaciones' })
  @IsOptional()
  @IsString()
  description?: string;
}

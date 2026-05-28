import { IsArray, IsString, IsNotEmpty, ValidateNested, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ZipFileEntryDto {
  @ApiProperty({ description: 'Storage key del archivo en R2' })
  @IsString()
  @IsNotEmpty()
  storageKey!: string;

  @ApiProperty({ description: 'Ruta relativa dentro del ZIP (ej. "Adjuntos/doc.pdf")' })
  @IsString()
  @IsNotEmpty()
  zipPath!: string;
}

export class DownloadZipDto {
  @ApiProperty({ type: [ZipFileEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ZipFileEntryDto)
  files!: ZipFileEntryDto[];

  @ApiProperty({ description: 'Nombre del workflow — usado como nombre del archivo ZIP' })
  @IsString()
  @IsNotEmpty()
  title!: string;
}

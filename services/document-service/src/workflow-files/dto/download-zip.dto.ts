import { IsArray, IsString, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ZipFileEntryDto {
  @ApiProperty({ description: 'Storage key del archivo en R2' })
  @IsString()
  storageKey!: string;

  @ApiProperty({ description: 'Ruta relativa dentro del ZIP (ej. "Adjuntos/doc.pdf")' })
  @IsString()
  zipPath!: string;
}

export class DownloadZipDto {
  @ApiProperty({ type: [ZipFileEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMaxSize(100)
  @Type(() => ZipFileEntryDto)
  files!: ZipFileEntryDto[];

  @ApiProperty({ description: 'Nombre del workflow — usado como nombre del archivo ZIP' })
  @IsString()
  title!: string;
}

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, IsNumber, Min, IsArray, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ApproveAttachmentDto {
  @IsString() @MaxLength(500)
  storageKey!: string;

  @IsString() @MaxLength(500)
  originalName!: string;

  @IsString() @MaxLength(100)
  mimeType!: string;

  @IsOptional() @IsNumber() @Min(1)
  @Type(() => Number)
  fileSizeBytes?: number;
}

export class ApproveWorkflowDto {
  @ApiPropertyOptional({
    description: 'Observaciones opcionales al aprobar',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  observations?: string;

  /**
   * Documentos adjuntos subidos por el aprobador.
   * Cada archivo debe haberse subido previamente via POST /api/documents/:orgId/workflow-files.
   */
  @ApiPropertyOptional({
    type: [ApproveAttachmentDto],
    description: 'Lista de adjuntos subidos via workflow-files (document-service)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApproveAttachmentDto)
  attachments?: ApproveAttachmentDto[];
}

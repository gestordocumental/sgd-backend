import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, MaxLength, IsNumber, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class AdminStepAttachmentDto {
  @ApiProperty() @IsString() @MaxLength(500) storageKey!: string;
  @ApiProperty() @IsString() @MaxLength(500) originalName!: string;
  @ApiProperty() @IsString() @MaxLength(100) mimeType!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fileSizeBytes?: number;
}

/**
 * [RN-13] Solo el usuario asignado al paso puede completarlo.
 * El usuario puede adjuntar documentos, dejar notas, o completar sin ninguno de los dos.
 */
export class CompleteAdminStepDto {
  @ApiPropertyOptional({
    description: 'Nota u observación del usuario administrativo',
    maxLength: 3000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  notes?: string;

  @ApiPropertyOptional({
    type: [AdminStepAttachmentDto],
    description: 'Documentos adjuntados en este paso',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminStepAttachmentDto)
  attachments?: AdminStepAttachmentDto[];
}

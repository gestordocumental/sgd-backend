import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, MaxLength, IsNumber, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class WorkflowNoteAttachmentDto {
  @ApiProperty() @IsString() @MaxLength(500) storageKey!: string;
  @ApiProperty() @IsString() @MaxLength(500) originalName!: string;
  @ApiProperty() @IsString() @MaxLength(100) mimeType!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() fileSizeBytes?: number;
}

/**
 * "Gestionar" — el usuario final deja un comentario y/o adjuntos en el
 * workflow mientras está AVAILABLE_FOR_FINAL_USERS, sin iniciar un ciclo
 * administrativo. Repetible: no hay límite de veces que puede llamarse.
 * El servicio exige al menos uno de los dos campos (ver workflow-admin-cycle.service.ts).
 */
export class AddWorkflowNoteDto {
  @ApiPropertyOptional({
    description: 'Comentario del usuario final',
    maxLength: 3000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  content?: string;

  @ApiPropertyOptional({
    type: [WorkflowNoteAttachmentDto],
    description: 'Documentos adjuntados junto con el comentario',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowNoteAttachmentDto)
  attachments?: WorkflowNoteAttachmentDto[];
}

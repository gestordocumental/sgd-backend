import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsArray, MaxLength, IsNumber, ValidateNested, Matches } from 'class-validator';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import { Transform, Type } from 'class-transformer';
import { AdminStepAttachmentDto } from './complete-admin-step.dto';

/**
 * DTO para reenviar un paso administrativo a un revisor opcional.
 * Solo los revisores obligatorios (mandatory) pueden invocar a un revisor opcional.
 * El revisor opcional debe estar en la lista allowedOptionalReviewerIds del ciclo.
 */
export class ForwardAdminStepDto {
  @ApiProperty({
    format: 'uuid',
    description: 'UUID del revisor opcional al que se reenvía el paso.',
  })
  @Matches(UUID_REGEX, { message: 'optionalReviewerId must be a UUID' })
  optionalReviewerId!: string;

  @ApiPropertyOptional({
    description: 'Nota u observación del usuario que reenvía.',
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
    description: 'Documentos adjuntados al reenviar el paso.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdminStepAttachmentDto)
  attachments?: AdminStepAttachmentDto[];
}

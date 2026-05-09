import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsArray, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * El creador reenvía el workflow al mismo aprobador que rechazó.
 * [RN-19] El flujo continúa desde el step rechazado, no reinicia desde el principio.
 */
export class ResubmitWorkflowDto {
  @ApiPropertyOptional({
    description: 'Descripción de los cambios realizados por el creador',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  observations?: string;

  @ApiPropertyOptional({
    description: 'Nuevo documento principal si fue reemplazado',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  updatedMainDocumentId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Nuevos adjuntos añadidos junto con el reenvío',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  newAttachmentIds?: string[];
}

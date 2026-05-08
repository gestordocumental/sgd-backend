import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * [RN-14] No se puede cerrar si hay un ciclo administrativo activo.
 * [RN-16] Solo el usuario final que inició el último ciclo puede cerrar.
 */
export class CloseWorkflowDto {
  @ApiPropertyOptional({
    description: 'Nota de cierre del usuario final',
    maxLength: 2000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  closingNotes?: string;
}

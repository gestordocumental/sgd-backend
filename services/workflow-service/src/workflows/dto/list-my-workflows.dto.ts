import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsInt, Min, Max, IsString, IsNotEmpty, MaxLength } from 'class-validator';
import { WorkflowStatus } from '../entities/enums';

/**
 * Filtros + paginación de "Mis tareas" (/workflows/my-tasks) y "Mis flujos"
 * (/workflows/my-available). Mismo contrato que ListWorkflowsDto (sin
 * createdBy, que no aplica aquí — el scope ya está fijado al usuario
 * autenticado) para que el filtrado por título/estado/tipología se resuelva
 * en SQL antes de paginar, en vez de sobre un array ya truncado en el
 * backend — así un flujo puntual se puede encontrar sin importar su
 * posición por fecha de actualización.
 */
export class ListMyWorkflowsDto {
  @ApiPropertyOptional({ enum: WorkflowStatus })
  @IsOptional()
  @IsEnum(WorkflowStatus)
  status?: WorkflowStatus;

  @ApiPropertyOptional({ description: 'Búsqueda por título o descripción (case-insensitive)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ description: 'Filtrar por tipología' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  typologyId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

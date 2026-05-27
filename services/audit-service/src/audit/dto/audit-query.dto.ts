import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsInt, Min, Max, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';


export class AuditQueryDto {
  @ApiPropertyOptional({ description: 'Filtrar por organización (UUID)' })
  @IsOptional()
  @IsString()
  orgId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por actor (UUID del usuario)' })
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por tipo de recurso (workflow, document, user…)' })
  @IsOptional()
  @IsString()
  resourceType?: string;

  @ApiPropertyOptional({ description: 'Filtrar por ID de recurso (UUID)' })
  @IsOptional()
  @IsString()
  resourceId?: string;

  @ApiPropertyOptional({ description: 'Filtrar por acción / tipo de evento' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Filtrar por microservicio origen' })
  @IsOptional()
  @IsString()
  service?: string;

  @ApiPropertyOptional({ description: 'Fecha/hora de inicio (ISO 8601)', example: '2024-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ description: 'Fecha/hora de fin (ISO 8601)', example: '2024-12-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Filtrar por correlation ID (UUID de la petición HTTP)' })
  @IsOptional()
  @IsString()
  correlationId?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

export interface AuditLogDocument {
  id:              string;
  service:         string;
  actorId:         string;
  orgId:           string | null;
  action:          string;
  resourceType:    string;
  resourceId:      string;
  resourceName?:   string | null;
  correlationId?:  string | null;
  ip?:             string | null;
  metadata:        Record<string, unknown> | null;
  timestamp:       string;
  indexedAt:       string;
}

export interface PaginatedAuditLogs {
  data:  AuditLogDocument[];
  total: number;
  page:  number;
  limit: number;
}

export class AuditExportDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  orgId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  resourceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  service?: string;

  @ApiPropertyOptional({ example: '2024-01-01T00:00:00Z' })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ example: '2024-12-31T23:59:59Z' })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ description: 'Filtrar por correlation ID' })
  @IsOptional()
  @IsString()
  correlationId?: string;

  @ApiPropertyOptional({ default: 1000, minimum: 1, maximum: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number = 1000;
}

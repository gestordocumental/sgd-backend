import { Injectable, OnModuleInit } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';
import { AppLogger, getCorrelationId } from '@sgd/common';
import { AuditLogEvent } from './dto/audit-log-event.dto';
import {
  AuditLogDocument,
  AuditQueryDto,
  AuditExportDto,
  PaginatedAuditLogs,
} from './dto/audit-query.dto';

const INDEX = 'audit-logs';

@Injectable()
export class AuditService implements OnModuleInit {
  constructor(
    private readonly es: ElasticsearchService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Crea el índice en Elasticsearch si no existe al arrancar el servicio.
   * El mapping define los tipos de los campos más importantes para búsquedas eficientes.
   */
  async onModuleInit() {
    try {
      const exists = await this.es.indices.exists({ index: INDEX });
      if (!exists) {
        await this.es.indices.create({
          index: INDEX,
          mappings: {
            properties: {
              service:       { type: 'keyword' },
              actorId:       { type: 'keyword' },
              orgId:         { type: 'keyword' },
              action:        { type: 'keyword' },
              resourceType:  { type: 'keyword' },
              resourceId:    { type: 'keyword' },
              resourceName:  { type: 'keyword' },
              correlationId: { type: 'keyword' },
              ip:            { type: 'keyword' },
              metadata:      { type: 'object', enabled: false },
              timestamp:     { type: 'date' },
              indexedAt:     { type: 'date' },
            },
          },
          settings: {
            number_of_shards:   1,
            number_of_replicas: 0,
          },
        });
        this.logger.log(`Elasticsearch index "${INDEX}" created`, 'AuditService');
      }
    } catch (err: unknown) {
      this.logger.error(
        `Failed to initialize Elasticsearch index "${INDEX}"`,
        err instanceof Error ? err.stack : String(err),
        'AuditService',
      );
    }
  }

  async index(event: AuditLogEvent): Promise<void> {
    const httpCorrelationId = getCorrelationId();
    const resolvedCorrelationId =
      event.correlationId                                          // 1. ID de negocio explícito (ej: workflowId)
      ?? (httpCorrelationId !== 'no-correlation-id' ? httpCorrelationId : null); // 2. ID de la petición HTTP

    const doc: Omit<AuditLogDocument, 'id'> = {
      ...event,
      correlationId: resolvedCorrelationId,
      ip:            event.ip ?? null,
      indexedAt:     new Date().toISOString(),
    };

    await this.es.index({ index: INDEX, document: doc });

    this.logger.log(
      `Indexed audit event: service=${event.service} action=${event.action} resource=${event.resourceType}/${event.resourceId}`,
      'AuditService',
    );
  }

  /**
   * Construye las cláusulas must de Elasticsearch.
   *
   * superAdminScope=true → restringe a eventos SIN orgId (acciones de super admin puras).
   * superAdminScope=false + dto.orgId → restringe a esa organización concreta.
   */
  private buildMustClauses(
    dto: {
      orgId?: string;
      actorId?: string;
      resourceType?: string;
      resourceId?: string;
      action?: string;
      service?: string;
      correlationId?: string;
      from?: string;
      to?: string;
    },
    superAdminScope = false,
  ): object[] {
    const must: object[] = [];

    if (superAdminScope) {
      // Eventos de super admin: documentos donde orgId no existe o es null
      must.push({ bool: { must_not: { exists: { field: 'orgId' } } } });
    } else if (dto.orgId) {
      must.push({ term: { orgId: dto.orgId } });
    }

    if (dto.actorId)       must.push({ term: { actorId:       dto.actorId } });
    if (dto.resourceType)  must.push({ term: { resourceType:  dto.resourceType } });
    if (dto.resourceId)    must.push({ term: { resourceId:    dto.resourceId } });
    if (dto.action)        must.push({ term: { action:        dto.action } });
    if (dto.service)       must.push({ term: { service:       dto.service } });
    if (dto.correlationId) must.push({ term: { correlationId: dto.correlationId } });

    if (dto.from || dto.to) {
      const range: Record<string, string> = {};
      if (dto.from) range['gte'] = dto.from;
      if (dto.to)   range['lte'] = dto.to;
      must.push({ range: { timestamp: range } });
    }

    return must;
  }

  async query(dto: AuditQueryDto, superAdminScope = false): Promise<PaginatedAuditLogs> {
    const page  = dto.page  ?? 1;
    const limit = dto.limit ?? 50;
    const from  = (page - 1) * limit;

    const must = this.buildMustClauses(dto, superAdminScope);

    const response = await this.es.search<AuditLogDocument>({
      index: INDEX,
      from,
      size:  limit,
      query: must.length > 0 ? { bool: { must } } : { match_all: {} },
      sort:  [{ timestamp: { order: 'desc' } }],
    });

    const hits  = response.hits.hits;
    const total = typeof response.hits.total === 'number'
      ? response.hits.total
      : (response.hits.total?.value ?? 0);

    const data: AuditLogDocument[] = hits.map((hit) => ({
      id: hit._id ?? '',
      ...(hit._source as Omit<AuditLogDocument, 'id'>),
    }));

    return { data, total, page, limit };
  }

  async export(dto: AuditExportDto, superAdminScope = false): Promise<AuditLogDocument[]> {
    const limit = dto.limit ?? 1000;
    const must  = this.buildMustClauses(dto, superAdminScope);

    const response = await this.es.search<AuditLogDocument>({
      index: INDEX,
      from:  0,
      size:  limit,
      query: must.length > 0 ? { bool: { must } } : { match_all: {} },
      sort:  [{ timestamp: { order: 'desc' } }],
    });

    return response.hits.hits.map((hit) => ({
      id: hit._id ?? '',
      ...(hit._source as Omit<AuditLogDocument, 'id'>),
    }));
  }

  async findById(id: string): Promise<AuditLogDocument | null> {
    try {
      const response = await this.es.get<AuditLogDocument>({ index: INDEX, id });
      if (!response.found) return null;
      return { id: response._id, ...response._source } as AuditLogDocument;
    } catch (err: unknown) {
      const statusCode = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
      if (statusCode === 404) return null;
      throw err;
    }
  }
}

import { Injectable, OnModuleInit, Inject } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { AppLogger, getCorrelationId } from '@sgd/common';
import { AuditLogEvent } from './dto/audit-log-event.dto';
import {
  AuditLogDocument,
  AuditQueryDto,
  AuditExportDto,
  PaginatedAuditLogs,
} from './dto/audit-query.dto';
import { ES_WRITE_CLIENT, ES_READ_CLIENT } from './es-client.tokens';

const INDEX = 'audit-logs';

function isIndexNotFound(err: unknown): boolean {
  return (err as { meta?: { body?: { error?: { type?: string } } } })
    ?.meta?.body?.error?.type === 'index_not_found_exception';
}

@Injectable()
export class AuditService implements OnModuleInit {
  constructor(
    @Inject(ES_WRITE_CLIENT) private readonly writeClient: Client,
    @Inject(ES_READ_CLIENT)  private readonly readClient: Client,
    private readonly logger: AppLogger,
  ) {}

  async onModuleInit() {
    await this.ensureIndex();
  }

  private async ensureIndex(): Promise<void> {
    const exists = await this.writeClient.indices.exists({ index: INDEX });
    if (!exists) {
      await this.writeClient.indices.create({
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
            correlationId: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
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

    await this.writeClient.index({ index: INDEX, document: doc });

    this.logger.log(
      `Indexed audit event: service=${event.service} action=${event.action} resource=${event.resourceType}/${event.resourceId}`,
      'AuditService',
    );
  }

  /**
   * Construye las cláusulas must de Elasticsearch.
   *
   * superAdminScope=true + sin dto.orgId → eventos de plataforma (orgId ausente/null).
   * superAdminScope=true + dto.orgId    → eventos de esa empresa específica.
   * superAdminScope=false + dto.orgId   → eventos de la org + eventos de company management donde resourceId = orgId.
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
      if (dto.orgId) {
        // Super admin filtrando por empresa específica → eventos de esa org
        must.push({ term: { orgId: dto.orgId } });
      } else {
        // Vista global de super admin → solo eventos de plataforma (orgId ausente/null)
        must.push({ bool: { must_not: { exists: { field: 'orgId' } } } });
      }
    } else if (dto.orgId) {
      // Org user: sus propios eventos de org + eventos de company management donde su org es el recurso
      must.push({
        bool: {
          should: [
            { term: { orgId: dto.orgId } },
            {
              bool: {
                must: [
                  { bool: { must_not: { exists: { field: 'orgId' } } } },
                  { term: { resourceId: dto.orgId } },
                ],
              },
            },
          ],
          minimum_should_match: 1,
        },
      });
    }

    if (dto.actorId)       must.push({ term: { actorId:                    dto.actorId } });
    if (dto.resourceType)  must.push({ term: { resourceType:              dto.resourceType } });
    if (dto.resourceId)    must.push({ term: { resourceId:                dto.resourceId } });
    if (dto.action)        must.push({ term: { action:                    dto.action } });
    if (dto.service)       must.push({ term: { service:                   dto.service } });
    // Support both the new mapping (correlationId.keyword sub-field) and legacy
    // indexes where correlationId was mapped as a plain keyword, until a reindex
    // completes. Both branches produce an exact-match term query.
    if (dto.correlationId) {
      must.push({
        bool: {
          should: [
            { term: { 'correlationId.keyword': dto.correlationId } },
            { term: { correlationId: dto.correlationId } },
          ],
          minimum_should_match: 1,
        },
      });
    }

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

    try {
      const response = await this.readClient.search<AuditLogDocument>({
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
    } catch (err: unknown) {
      if (isIndexNotFound(err)) {
        this.logger.warn(`Index "${INDEX}" not found during query — triggering ensureIndex`, 'AuditService');
        void this.ensureIndex().catch((e: unknown) =>
          this.logger.error('Recovery ensureIndex failed', e instanceof Error ? e.stack : String(e), 'AuditService'),
        );
        return { data: [], total: 0, page, limit };
      }
      throw err;
    }
  }

  async export(dto: AuditExportDto, superAdminScope = false): Promise<AuditLogDocument[]> {
    const limit = dto.limit ?? 1000;
    const must  = this.buildMustClauses(dto, superAdminScope);

    try {
      const response = await this.readClient.search<AuditLogDocument>({
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
    } catch (err: unknown) {
      if (isIndexNotFound(err)) {
        this.logger.warn(`Index "${INDEX}" not found during export — triggering ensureIndex`, 'AuditService');
        void this.ensureIndex().catch((e: unknown) =>
          this.logger.error('Recovery ensureIndex failed', e instanceof Error ? e.stack : String(e), 'AuditService'),
        );
        return [];
      }
      throw err;
    }
  }

  async findById(id: string): Promise<AuditLogDocument | null> {
    try {
      const response = await this.readClient.get<AuditLogDocument>({ index: INDEX, id });
      if (!response.found) return null;
      return { id: response._id, ...response._source } as AuditLogDocument;
    } catch (err: unknown) {
      const statusCode = (err as { meta?: { statusCode?: number } })?.meta?.statusCode;
      if (statusCode === 404) return null;
      throw err;
    }
  }
}

import { AuditService } from './audit.service';
import { AuditLogEvent } from './dto/audit-log-event.dto';
import { AuditQueryDto, AuditExportDto } from './dto/audit-query.dto';
import { AppLogger } from '@sgd/common';

type MockLogger = jest.Mocked<Pick<AppLogger, 'log' | 'warn' | 'error'>>;

// ── mocks ──────────────────────────────────────────────────────────────────

jest.mock('@sgd/common', () => ({
  ...jest.requireActual('@sgd/common'),
  getCorrelationId: jest.fn().mockReturnValue('http-corr-id'),
}));

function makeEs() {
  return {
    indices: {
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn().mockResolvedValue({}),
    },
    index:  jest.fn().mockResolvedValue({ _id: 'doc-new' }),
    search: jest.fn().mockResolvedValue({ hits: { hits: [], total: { value: 0 } } }),
    get:    jest.fn(),
  };
}

function makeLogger(): MockLogger {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

// ── fixtures ───────────────────────────────────────────────────────────────

const validEvent: AuditLogEvent = {
  service:      'workflow-service',
  actorId:      'actor-1',
  orgId:        'org-1',
  action:       'WORKFLOW_CREATED',
  resourceType: 'workflow',
  resourceId:   'res-1',
  metadata:     null,
  timestamp:    '2024-01-01T00:00:00Z',
};

function makeHit(id: string, source: object) {
  return { _id: id, _source: source };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('AuditService', () => {
  let service: AuditService;
  let es: ReturnType<typeof makeEs>;
  let logger: MockLogger;

  beforeEach(() => {
    es      = makeEs();
    logger  = makeLogger();
    service = new AuditService(es as any, logger as any);
    jest.clearAllMocks();
    // Reset the correlation mock to a known default
    const ctx = require('@sgd/common');
    ctx.getCorrelationId.mockReturnValue('http-corr-id');
  });

  // ── onModuleInit ──────────────────────────────────────────────────────────

  describe('onModuleInit', () => {
    it('creates index when it does not exist', async () => {
      es.indices.exists.mockResolvedValue(false);

      await service.onModuleInit();

      expect(es.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'audit-logs' }),
      );
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('created'),
        'AuditService',
      );
    });

    it('skips creation when index already exists', async () => {
      es.indices.exists.mockResolvedValue(true);

      await service.onModuleInit();

      expect(es.indices.create).not.toHaveBeenCalled();
    });

    it('logs error (does not throw) when Elasticsearch is unavailable', async () => {
      es.indices.exists.mockRejectedValue(new Error('ES connection refused'));

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize'),
        expect.any(String),
        'AuditService',
      );
    });

    it('logs error with fallback string when non-Error is thrown', async () => {
      es.indices.exists.mockRejectedValue('plain string error');

      await service.onModuleInit();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize'),
        'plain string error',
        'AuditService',
      );
    });
  });

  // ── index ─────────────────────────────────────────────────────────────────

  describe('index', () => {
    it('uses the event\'s own correlationId when provided', async () => {
      const event = { ...validEvent, correlationId: 'biz-corr-id' };

      await service.index(event);

      const call = es.index.mock.calls[0][0];
      expect(call.document.correlationId).toBe('biz-corr-id');
    });

    it('falls back to HTTP correlationId when event has none', async () => {
      const ctx = require('@sgd/common');
      ctx.getCorrelationId.mockReturnValue('http-corr-id');

      await service.index(validEvent);

      const call = es.index.mock.calls[0][0];
      expect(call.document.correlationId).toBe('http-corr-id');
    });

    it('sets correlationId to null when HTTP returns no-correlation-id sentinel', async () => {
      const ctx = require('@sgd/common');
      ctx.getCorrelationId.mockReturnValue('no-correlation-id');

      await service.index(validEvent);

      const call = es.index.mock.calls[0][0];
      expect(call.document.correlationId).toBeNull();
    });

    it('sets ip to null when event.ip is undefined', async () => {
      await service.index(validEvent); // validEvent has no ip

      const call = es.index.mock.calls[0][0];
      expect(call.document.ip).toBeNull();
    });

    it('preserves ip from event when provided', async () => {
      await service.index({ ...validEvent, ip: '192.168.1.1' });

      const call = es.index.mock.calls[0][0];
      expect(call.document.ip).toBe('192.168.1.1');
    });

    it('logs indexed event details', async () => {
      await service.index(validEvent);

      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('workflow-service'),
        'AuditService',
      );
    });

    it('adds indexedAt timestamp to the document', async () => {
      const before = new Date().toISOString();
      await service.index(validEvent);
      const after = new Date().toISOString();

      const call = es.index.mock.calls[0][0];
      expect(call.document.indexedAt >= before).toBe(true);
      expect(call.document.indexedAt <= after).toBe(true);
    });
  });

  // ── query ─────────────────────────────────────────────────────────────────

  describe('query', () => {
    it('uses match_all when no filters are provided', async () => {
      await service.query({});

      const call = es.search.mock.calls[0][0];
      expect(call.query).toEqual({ match_all: {} });
    });

    it('builds bool.must with all supported filters', async () => {
      const dto: AuditQueryDto = {
        orgId:         'org-1',
        actorId:       'actor-1',
        resourceType:  'workflow',
        resourceId:    'res-1',
        action:        'CREATED',
        service:       'workflow-service',
        correlationId: 'corr-1',
        from:          '2024-01-01T00:00:00Z',
        to:            '2024-12-31T23:59:59Z',
        page:          2,
        limit:         10,
      };

      const result = await service.query(dto);

      const call = es.search.mock.calls[0][0];
      expect(call.query.bool.must).toHaveLength(8); // 7 terms + 1 range
      expect(call.from).toBe(10);    // (2-1)*10
      expect(call.size).toBe(10);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });

    it('adds only range filter when only from/to provided', async () => {
      await service.query({ from: '2024-01-01T00:00:00Z', to: '2024-06-30T23:59:59Z' });

      const call = es.search.mock.calls[0][0];
      expect(call.query.bool.must).toHaveLength(1);
      expect(call.query.bool.must[0]).toEqual({
        range: { timestamp: { gte: '2024-01-01T00:00:00Z', lte: '2024-06-30T23:59:59Z' } },
      });
    });

    it('handles numeric total from Elasticsearch response', async () => {
      es.search.mockResolvedValue({ hits: { hits: [], total: 42 } });

      const result = await service.query({});

      expect(result.total).toBe(42);
    });

    it('handles total.value from Elasticsearch response', async () => {
      es.search.mockResolvedValue({ hits: { hits: [], total: { value: 15 } } });

      const result = await service.query({});

      expect(result.total).toBe(15);
    });

    it('maps hits to AuditLogDocuments', async () => {
      const source = { ...validEvent, indexedAt: '2024-01-01T01:00:00Z', correlationId: null, ip: null };
      es.search.mockResolvedValue({ hits: { hits: [makeHit('doc-1', source)], total: { value: 1 } } });

      const result = await service.query({});

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('doc-1');
      expect(result.data[0].service).toBe('workflow-service');
    });

    it('applies default page=1 and limit=50 when not specified', async () => {
      await service.query({});

      const call = es.search.mock.calls[0][0];
      expect(call.from).toBe(0);
      expect(call.size).toBe(50);
    });
  });

  // ── export ────────────────────────────────────────────────────────────────

  describe('export', () => {
    it('starts from 0 and uses default limit 1000', async () => {
      es.search.mockResolvedValue({ hits: { hits: [], total: { value: 0 } } });

      await service.export({});

      const call = es.search.mock.calls[0][0];
      expect(call.from).toBe(0);
      expect(call.size).toBe(1000);
      expect(call.query).toEqual({ match_all: {} });
    });

    it('applies all supported filters', async () => {
      const source = { ...validEvent, indexedAt: 'now', correlationId: null, ip: null };
      es.search.mockResolvedValue({ hits: { hits: [makeHit('e-1', source)], total: { value: 1 } } });

      const dto: AuditExportDto = {
        orgId:         'org-1',
        actorId:       'actor-1',
        resourceType:  'workflow',
        resourceId:    'res-1',
        action:        'CREATED',
        service:       'workflow-service',
        correlationId: 'corr-1',
        from:          '2024-01-01T00:00:00Z',
        to:            '2024-06-30T23:59:59Z',
        limit:         500,
      };

      const result = await service.export(dto);

      const call = es.search.mock.calls[0][0];
      expect(call.size).toBe(500);
      expect(call.query.bool.must).toHaveLength(8); // 7 terms + 1 range
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('e-1');
    });

    it('maps hit._id to id field', async () => {
      const source = { ...validEvent, indexedAt: 'now', correlationId: null, ip: null };
      es.search.mockResolvedValue({ hits: { hits: [makeHit('exported-1', source)] } });

      const result = await service.export({});

      expect(result[0].id).toBe('exported-1');
    });
  });

  // ── findById ──────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the document when found', async () => {
      const source = { ...validEvent, indexedAt: 'now', correlationId: null, ip: null };
      es.get.mockResolvedValue({ found: true, _id: 'doc-1', _source: source });

      const result = await service.findById('doc-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('doc-1');
      expect(result!.service).toBe('workflow-service');
    });

    it('returns null when found=false', async () => {
      es.get.mockResolvedValue({ found: false, _id: 'doc-1' });

      const result = await service.findById('doc-1');

      expect(result).toBeNull();
    });

    it('returns null for a 404 error status', async () => {
      es.get.mockRejectedValue({ meta: { statusCode: 404 } });

      const result = await service.findById('not-exists');

      expect(result).toBeNull();
    });

    it('rethrows errors with non-404 status codes', async () => {
      const err = { meta: { statusCode: 500 } };
      es.get.mockRejectedValue(err);

      await expect(service.findById('doc-1')).rejects.toEqual(err);
    });

    it('rethrows errors without meta.statusCode', async () => {
      const err = new Error('Network error');
      es.get.mockRejectedValue(err);

      await expect(service.findById('doc-1')).rejects.toThrow('Network error');
    });
  });
});

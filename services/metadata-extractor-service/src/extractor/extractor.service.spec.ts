import { ExtractorService } from './extractor.service';

// ── Module-level mock for parser.factory ──────────────────────────────────────

jest.mock('./parsers/parser.factory', () => ({
  extractStructured: jest.fn(),
}));

import { extractStructured } from './parsers/parser.factory';
import { TOPICS } from '../common/kafka/kafka.constants';

const mockExtractStructured = extractStructured as jest.MockedFunction<typeof extractStructured>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeps(overrides: {
  storage?: any;
  producer?: any;
  rules?: any;
} = {}) {
  const storage = overrides.storage ?? {
    download: jest.fn().mockResolvedValue(Buffer.from('file content')),
  };
  const producer = overrides.producer ?? {
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const rules = overrides.rules ?? {
    extract: jest.fn().mockReturnValue({ nombre: 'Policy', codigo: 'POL-001', version: '1.0' }),
  };
  const kafka = {
    consumer: jest.fn().mockReturnValue({
      connect:    jest.fn().mockResolvedValue(undefined),
      subscribe:  jest.fn().mockResolvedValue(undefined),
      run:        jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    }),
  };
  const config  = { getOrThrow: jest.fn().mockReturnValue('test-group') };
  const logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { kafka, config, producer, storage, rules, logger };
}

function makeMessage(value: object | null) {
  return {
    message: {
      value: value === null ? null : Buffer.from(JSON.stringify(value)),
    },
  } as any;
}

function makeService(deps = makeDeps()) {
  return new ExtractorService(
    deps.kafka as any,
    deps.config as any,
    deps.producer as any,
    deps.storage as any,
    deps.rules as any,
    deps.logger as any,
  );
}

// ── ExtractorService ──────────────────────────────────────────────────────────

describe('ExtractorService', () => {

  beforeEach(() => {
    mockExtractStructured.mockReset();
  });

  // ── handleFileUploaded() ──────────────────────────────────────────────────

  describe('handleFileUploaded()', () => {
    it('does nothing when message.value is null', async () => {
      const deps    = makeDeps();
      const service = makeService(deps);
      await (service as any).handleFileUploaded(makeMessage(null));
      expect(deps.storage.download).not.toHaveBeenCalled();
      expect(deps.producer.emit).not.toHaveBeenCalled();
    });

    it('warns and returns when message value is malformed JSON', async () => {
      const deps    = makeDeps();
      const service = makeService(deps);
      const badMsg  = { message: { value: Buffer.from('not-json') } } as any;
      await (service as any).handleFileUploaded(badMsg);
      expect(deps.logger.warn).toHaveBeenCalled();
      expect(deps.storage.download).not.toHaveBeenCalled();
    });

    it('warns and returns when payload is missing required fields', async () => {
      const deps    = makeDeps();
      const service = makeService(deps);
      // Missing r2Key and mimeType
      await (service as any).handleFileUploaded(makeMessage({ orgId: 'org-1', typologyId: 'typo-1' }));
      expect(deps.logger.warn).toHaveBeenCalled();
      expect(deps.storage.download).not.toHaveBeenCalled();
    });

    it('emits failure when extractStructured returns null (unsupported MIME)', async () => {
      mockExtractStructured.mockResolvedValue(null);
      const deps    = makeDeps();
      const service = makeService(deps);

      await (service as any).handleFileUploaded(makeMessage({
        orgId: 'org-1', typologyId: 'typo-1', r2Key: 'key', mimeType: 'image/jpeg',
      }));

      expect(deps.producer.emit).toHaveBeenCalledWith(
        TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED,
        expect.objectContaining({ orgId: 'org-1', typologyId: 'typo-1' }),
      );
      expect(deps.producer.emit).not.toHaveBeenCalledWith(
        TOPICS.TYPOLOGY_METADATA_EXTRACTED,
        expect.anything(),
      );
    });

    it('emits failure when document text is empty', async () => {
      mockExtractStructured.mockResolvedValue({
        text: '   ', titleCell: null, leftCell: null, rightCell: null,
      });
      const deps    = makeDeps();
      const service = makeService(deps);

      await (service as any).handleFileUploaded(makeMessage({
        orgId: 'org-1', typologyId: 'typo-1', r2Key: 'key', mimeType: 'application/pdf',
      }));

      expect(deps.producer.emit).toHaveBeenCalledWith(
        TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED,
        expect.objectContaining({ typologyId: 'typo-1' }),
      );
    });

    it('emits extracted metadata on success', async () => {
      mockExtractStructured.mockResolvedValue({
        text:      'Security Policy POL-001 version 1.0',
        titleCell: 'Security Policy',
        leftCell:  null,
        rightCell: 'Código: POL-001\nVersión: 1.0',
      });
      const deps    = makeDeps();
      const service = makeService(deps);

      await (service as any).handleFileUploaded(makeMessage({
        orgId: 'org-1', typologyId: 'typo-1', r2Key: 'org/org-1/file.pdf',
        mimeType: 'application/pdf', orgName: 'Helisa SAS',
      }));

      expect(deps.storage.download).toHaveBeenCalledWith('org/org-1/file.pdf');
      expect(deps.rules.extract).toHaveBeenCalledWith(expect.objectContaining({
        orgName: 'Helisa SAS',
        text:    'Security Policy POL-001 version 1.0',
      }));
      expect(deps.producer.emit).toHaveBeenCalledWith(
        TOPICS.TYPOLOGY_METADATA_EXTRACTED,
        expect.objectContaining({
          orgId:      'org-1',
          typologyId: 'typo-1',
          nombre:     'Policy',
          codigo:     'POL-001',
          version:    '1.0',
        }),
      );
    });

    it('passes orgName to rules.extract when provided', async () => {
      mockExtractStructured.mockResolvedValue({
        text: 'Document content', titleCell: null, leftCell: null, rightCell: null,
      });
      const deps    = makeDeps();
      const service = makeService(deps);

      await (service as any).handleFileUploaded(makeMessage({
        orgId: 'org-1', typologyId: 'typo-1', r2Key: 'key',
        mimeType: 'application/pdf', orgName: 'Acme Corp',
      }));

      expect(deps.rules.extract).toHaveBeenCalledWith(
        expect.objectContaining({ orgName: 'Acme Corp' }),
      );
    });

    it('passes undefined orgName as undefined to rules.extract when not in payload', async () => {
      mockExtractStructured.mockResolvedValue({
        text: 'Document content', titleCell: null, leftCell: null, rightCell: null,
      });
      const deps    = makeDeps();
      const service = makeService(deps);

      await (service as any).handleFileUploaded(makeMessage({
        orgId: 'org-1', typologyId: 'typo-1', r2Key: 'key', mimeType: 'application/pdf',
      }));

      expect(deps.rules.extract).toHaveBeenCalledWith(
        expect.objectContaining({ orgName: undefined }),
      );
    });

    it('emits failure when storage.download throws', async () => {
      const deps = makeDeps({
        storage: { download: jest.fn().mockRejectedValue(new Error('ECONNRESET')) },
      });
      const service = makeService(deps);

      await (service as any).handleFileUploaded(makeMessage({
        orgId: 'org-1', typologyId: 'typo-1', r2Key: 'key', mimeType: 'application/pdf',
      }));

      expect(deps.logger.error).toHaveBeenCalled();
      // Raw error details stay in logs only — the Kafka event carries a safe generic message.
      expect(deps.producer.emit).toHaveBeenCalledWith(
        TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED,
        expect.objectContaining({ reason: 'Extraction failed due to an internal error' }),
      );
    });

    it('emits failure when rules.extract throws', async () => {
      mockExtractStructured.mockResolvedValue({
        text: 'Document content', titleCell: null, leftCell: null, rightCell: null,
      });
      const deps = makeDeps({
        rules: { extract: jest.fn().mockImplementation(() => { throw new Error('Rule error'); }) },
      });
      const service = makeService(deps);

      await (service as any).handleFileUploaded(makeMessage({
        orgId: 'org-1', typologyId: 'typo-1', r2Key: 'key', mimeType: 'application/pdf',
      }));

      // Raw error details stay in logs only — the Kafka event carries a safe generic message.
      expect(deps.producer.emit).toHaveBeenCalledWith(
        TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED,
        expect.objectContaining({ reason: 'Extraction failed due to an internal error' }),
      );
    });
  });

  // ── onApplicationBootstrap() / onApplicationShutdown() ───────────────────

  describe('lifecycle hooks', () => {
    it('connects consumer and subscribes on bootstrap', async () => {
      const deps    = makeDeps();
      const service = makeService(deps);

      await service.onApplicationBootstrap();

      const consumer = deps.kafka.consumer.mock.results[0].value;
      expect(consumer.connect).toHaveBeenCalled();
      expect(consumer.subscribe).toHaveBeenCalledWith(
        expect.objectContaining({ topics: [TOPICS.TYPOLOGY_FILE_UPLOADED] }),
      );
      expect(consumer.run).toHaveBeenCalled();
    });

    it('disconnects consumer on shutdown', async () => {
      const deps    = makeDeps();
      const service = makeService(deps);

      await service.onApplicationBootstrap();
      await service.onApplicationShutdown();

      const consumer = deps.kafka.consumer.mock.results[0].value;
      expect(consumer.disconnect).toHaveBeenCalled();
    });
  });
});

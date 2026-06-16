import { KafkaConsumerService } from './kafka-consumer.service';
import { TOPICS } from '@sgd/common';
import { Types } from 'mongoose';

// Short-circuit the DLT wrapper and correlation context — only dispatch() logic matters.
jest.mock('@sgd/common', () => ({
  ...jest.requireActual('@sgd/common'),
  runWithCorrelation: jest.fn((_msg: unknown, fn: () => Promise<void>) => fn()),
  withDlt:            jest.fn((_opts: unknown, fn: () => Promise<void>) => fn()),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeConsumer() {
  return {
    connect:    jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    subscribe:  jest.fn().mockResolvedValue(undefined),
    run:        jest.fn().mockResolvedValue(undefined),
  };
}

function makeKafka(consumer = makeConsumer()) {
  return { consumer: jest.fn().mockReturnValue(consumer) };
}

function makeConfig(groupId = 'test-group') {
  return { getOrThrow: jest.fn().mockReturnValue(groupId) };
}

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn() };
}

function makeProducer() {
  return { emit: jest.fn(), emitSafe: jest.fn() };
}

function makeService() {
  return new KafkaConsumerService(
    makeKafka() as any,
    makeConfig() as any,
    makeLogger() as any,
    makeProducer() as any,
  );
}

function validObjectId() {
  return new Types.ObjectId().toString();
}

function msgPayload(topic: string, value: Buffer | null) {
  return { topic, message: { value, headers: {} } };
}

// ── KafkaConsumerService ───────────────────────────────────────────────────

describe('KafkaConsumerService', () => {

  // ── lifecycle ─────────────────────────────────────────────────────────────

  describe('onApplicationBootstrap()', () => {
    it('connects, subscribes to both extraction topics, and starts consuming', async () => {
      const consumer = makeConsumer();
      const kafka    = makeKafka(consumer);
      const config   = makeConfig('my-group');
      const logger   = makeLogger();
      const svc      = new KafkaConsumerService(kafka as any, config as any, logger as any, makeProducer() as any);

      await svc.onApplicationBootstrap();

      expect(kafka.consumer).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'my-group' }));
      expect(consumer.connect).toHaveBeenCalled();
      expect(consumer.subscribe).toHaveBeenCalledWith(expect.objectContaining({
        topics: expect.arrayContaining([
          TOPICS.TYPOLOGY_METADATA_EXTRACTED,
          TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED,
        ]),
      }));
      expect(consumer.run).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith('Kafka consumer connected and listening', 'KafkaConsumerService');
    });
  });

  describe('onApplicationShutdown()', () => {
    it('disconnects the consumer', async () => {
      const consumer = makeConsumer();
      const svc      = new KafkaConsumerService(makeKafka(consumer) as any, makeConfig() as any, makeLogger() as any, makeProducer() as any);
      await svc.onApplicationBootstrap();

      await svc.onApplicationShutdown();

      expect(consumer.disconnect).toHaveBeenCalled();
    });
  });

  // ── dispatch() — tested directly via (svc as any).dispatch() ──────────────

  describe('dispatch()', () => {

    it('returns early when message.value is null', async () => {
      const svc = makeService();
      await expect((svc as any).dispatch(msgPayload(TOPICS.TYPOLOGY_METADATA_EXTRACTED, null)))
        .resolves.toBeUndefined();
    });

    it('warns and returns when message JSON is malformed', async () => {
      const logger = makeLogger();
      const svc    = new KafkaConsumerService(makeKafka() as any, makeConfig() as any, logger as any, makeProducer() as any);

      await (svc as any).dispatch(msgPayload(TOPICS.TYPOLOGY_METADATA_EXTRACTED, Buffer.from('not-json')));

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Malformed JSON'),
        'KafkaConsumerService',
      );
    });

    describe('TYPOLOGY_METADATA_EXTRACTED', () => {
      it('calls onExtracted with a valid payload', async () => {
        const svc         = makeService();
        const onExtracted = jest.fn().mockResolvedValue(undefined);
        svc.registerHandlers(onExtracted, jest.fn());

        const payload = { orgId: 'org-1', typologyId: validObjectId(), nombre: 'Doc', codigo: 'C-01', version: '01' };
        await (svc as any).dispatch(msgPayload(TOPICS.TYPOLOGY_METADATA_EXTRACTED, Buffer.from(JSON.stringify(payload))));

        expect(onExtracted).toHaveBeenCalledWith(payload);
      });

      it('accepts null nullable fields (nombre, codigo, version)', async () => {
        const svc         = makeService();
        const onExtracted = jest.fn().mockResolvedValue(undefined);
        svc.registerHandlers(onExtracted, jest.fn());

        const payload = { orgId: 'org-1', typologyId: validObjectId(), nombre: null, codigo: null, version: null };
        await (svc as any).dispatch(msgPayload(TOPICS.TYPOLOGY_METADATA_EXTRACTED, Buffer.from(JSON.stringify(payload))));

        expect(onExtracted).toHaveBeenCalledWith(payload);
      });

      it('warns and skips when payload is invalid (empty orgId)', async () => {
        const logger      = makeLogger();
        const svc         = new KafkaConsumerService(makeKafka() as any, makeConfig() as any, logger as any, makeProducer() as any);
        const onExtracted = jest.fn();
        svc.registerHandlers(onExtracted, jest.fn());

        const payload = { orgId: '', typologyId: validObjectId(), nombre: null, codigo: null, version: null };
        await (svc as any).dispatch(msgPayload(TOPICS.TYPOLOGY_METADATA_EXTRACTED, Buffer.from(JSON.stringify(payload))));

        expect(onExtracted).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid payload'), 'KafkaConsumerService');
      });

      it('warns and skips when typologyId is not a valid ObjectId', async () => {
        const logger      = makeLogger();
        const svc         = new KafkaConsumerService(makeKafka() as any, makeConfig() as any, logger as any, makeProducer() as any);
        const onExtracted = jest.fn();
        svc.registerHandlers(onExtracted, jest.fn());

        const payload = { orgId: 'org-1', typologyId: 'not-an-objectid', nombre: null, codigo: null, version: null };
        await (svc as any).dispatch(msgPayload(TOPICS.TYPOLOGY_METADATA_EXTRACTED, Buffer.from(JSON.stringify(payload))));

        expect(onExtracted).not.toHaveBeenCalled();
      });

      it('skips without calling onExtracted when no handler is registered', async () => {
        const svc         = makeService(); // no registerHandlers()
        const payload     = { orgId: 'org-1', typologyId: validObjectId(), nombre: null, codigo: null, version: null };

        await expect(
          (svc as any).dispatch(msgPayload(TOPICS.TYPOLOGY_METADATA_EXTRACTED, Buffer.from(JSON.stringify(payload)))),
        ).resolves.toBeUndefined();
      });
    });

    describe('TYPOLOGY_METADATA_EXTRACTION_FAILED', () => {
      it('calls onFailed with a valid payload', async () => {
        const svc      = makeService();
        const onFailed = jest.fn().mockResolvedValue(undefined);
        svc.registerHandlers(jest.fn(), onFailed);

        const payload = { orgId: 'org-1', typologyId: validObjectId(), reason: 'Timeout' };
        await (svc as any).dispatch(msgPayload(TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED, Buffer.from(JSON.stringify(payload))));

        expect(onFailed).toHaveBeenCalledWith(payload);
      });

      it('warns and skips when reason is missing', async () => {
        const logger   = makeLogger();
        const svc      = new KafkaConsumerService(makeKafka() as any, makeConfig() as any, logger as any, makeProducer() as any);
        const onFailed = jest.fn();
        svc.registerHandlers(jest.fn(), onFailed);

        const payload = { orgId: 'org-1', typologyId: validObjectId() };
        await (svc as any).dispatch(msgPayload(TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED, Buffer.from(JSON.stringify(payload))));

        expect(onFailed).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Invalid payload'), 'KafkaConsumerService');
      });

      it('skips without calling onFailed when no handler is registered', async () => {
        const svc     = makeService(); // no registerHandlers()
        const payload = { orgId: 'org-1', typologyId: validObjectId(), reason: 'Timeout' };

        await expect(
          (svc as any).dispatch(msgPayload(TOPICS.TYPOLOGY_METADATA_EXTRACTION_FAILED, Buffer.from(JSON.stringify(payload)))),
        ).resolves.toBeUndefined();
      });
    });

    it('does nothing for an unknown topic', async () => {
      const svc         = makeService();
      const onExtracted = jest.fn();
      const onFailed    = jest.fn();
      svc.registerHandlers(onExtracted, onFailed);

      await (svc as any).dispatch(msgPayload('some-other-topic', Buffer.from(JSON.stringify({ orgId: 'org-1' }))));

      expect(onExtracted).not.toHaveBeenCalled();
      expect(onFailed).not.toHaveBeenCalled();
    });
  });
});

import { KafkaProducerService } from './kafka-producer.service';

// ── Module-level mocks ────────────────────────────────────────────────────────

jest.mock('../correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('producer-correlation-id'),
}));

import { getCorrelationId } from '../correlation/correlation.context';

const mockGetCorrelationId = getCorrelationId as jest.MockedFunction<typeof getCorrelationId>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDeps(overrides: { producerOverrides?: Partial<Record<string, jest.Mock>> } = {}) {
  const mockSend       = jest.fn().mockResolvedValue(undefined);
  const mockConnect    = jest.fn().mockResolvedValue(undefined);
  const mockDisconnect = jest.fn().mockResolvedValue(undefined);

  const mockProducer = {
    send:       mockSend,
    connect:    mockConnect,
    disconnect: mockDisconnect,
    ...overrides.producerOverrides,
  };

  const kafka = {
    producer: jest.fn().mockReturnValue(mockProducer),
  };

  const logger = {
    log:  jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    http: jest.fn(),
  };

  return { kafka, logger, mockProducer, mockSend, mockConnect, mockDisconnect };
}

function makeService(deps = makeDeps()) {
  return new KafkaProducerService(deps.kafka as any, deps.logger as any);
}

// ── KafkaProducerService ──────────────────────────────────────────────────────

describe('KafkaProducerService', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── constructor ──────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates a producer from the kafka client', () => {
      const deps = makeDeps();
      makeService(deps);
      expect(deps.kafka.producer).toHaveBeenCalled();
    });
  });

  // ── onApplicationBootstrap() ─────────────────────────────────────────────────

  describe('onApplicationBootstrap()', () => {
    it('connects the producer and logs', async () => {
      const deps    = makeDeps();
      const service = makeService(deps);

      await service.onApplicationBootstrap();

      expect(deps.mockConnect).toHaveBeenCalled();
      expect(deps.logger.log).toHaveBeenCalledWith(
        'Kafka producer connected',
        'KafkaProducerService',
      );
    });

    it('propagates errors thrown by producer.connect', async () => {
      const deps = makeDeps({
        producerOverrides: { connect: jest.fn().mockRejectedValue(new Error('connect failed')) },
      });
      const service = makeService(deps);

      await expect(service.onApplicationBootstrap()).rejects.toThrow('connect failed');
    });
  });

  // ── onApplicationShutdown() ─────────────────────────────────────────────────

  describe('onApplicationShutdown()', () => {
    it('disconnects the producer', async () => {
      const deps    = makeDeps();
      const service = makeService(deps);

      await service.onApplicationBootstrap();
      await service.onApplicationShutdown();

      expect(deps.mockDisconnect).toHaveBeenCalled();
    });

    it('propagates errors thrown by producer.disconnect', async () => {
      const deps = makeDeps({
        producerOverrides: { disconnect: jest.fn().mockRejectedValue(new Error('disconnect failed')) },
      });
      const service = makeService(deps);

      await expect(service.onApplicationShutdown()).rejects.toThrow('disconnect failed');
    });
  });

  // ── emit() ───────────────────────────────────────────────────────────────────

  describe('emit()', () => {
    it('sends a message to the correct topic with the serialized payload', async () => {
      const deps    = makeDeps();
      const service = makeService(deps);
      const payload = { orgId: 'org-1', typologyId: 'typo-1', nombre: 'Policy' };

      await service.emit('test-topic', payload);

      expect(deps.mockSend).toHaveBeenCalledWith({
        topic: 'test-topic',
        messages: [{
          value:   JSON.stringify(payload),
          headers: {
            'x-correlation-id': 'producer-correlation-id',
            'content-type':     'application/json',
          },
        }],
      });
    });

    it('includes the current correlationId in the message headers', async () => {
      mockGetCorrelationId.mockReturnValueOnce('dynamic-id-xyz');
      const deps    = makeDeps();
      const service = makeService(deps);

      await service.emit('some-topic', { data: 'value' });

      expect(deps.mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              headers: expect.objectContaining({ 'x-correlation-id': 'dynamic-id-xyz' }),
            }),
          ]),
        }),
      );
    });

    it('calls logger.http to log the outgoing kafka message', async () => {
      const deps    = makeDeps();
      const service = makeService(deps);

      await service.emit('my-topic', { foo: 'bar' });

      expect(deps.logger.http).toHaveBeenCalledWith(
        expect.objectContaining({
          type:  'kafka-produce',
          topic: 'my-topic',
        }),
      );
    });

    it('propagates errors thrown by producer.send', async () => {
      const deps = makeDeps({
        producerOverrides: { send: jest.fn().mockRejectedValue(new Error('broker unavailable')) },
      });
      const service = makeService(deps);

      await expect(service.emit('any-topic', { x: 1 })).rejects.toThrow('broker unavailable');
    });

    it('serializes complex nested payloads correctly', async () => {
      const deps    = makeDeps();
      const service = makeService(deps);
      const payload = {
        orgId:      'org-2',
        nested:     { a: 1, b: [2, 3] },
        nullField:  null,
      };

      await service.emit('complex-topic', payload);

      const sentMessage = deps.mockSend.mock.calls[0][0].messages[0];
      expect(JSON.parse(sentMessage.value)).toEqual(payload);
    });
  });
});

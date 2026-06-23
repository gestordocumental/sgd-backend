import { KafkaProducerService } from '@sgd/common';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('kafka-correlation-id'),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeProducer() {
  return {
    connect:    jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send:       jest.fn().mockResolvedValue(undefined),
  };
}

function makeKafka(producer = makeProducer()) {
  return { producer: jest.fn().mockReturnValue(producer) };
}

function makeLogger() {
  return { log: jest.fn(), error: jest.fn(), warn: jest.fn(), http: jest.fn() };
}

// ── KafkaProducerService ─────────────────────────────────────────────────────

describe('KafkaProducerService', () => {
  // ── lifecycle ─────────────────────────────────────────────────────────────

  describe('onApplicationBootstrap()', () => {
    it('connects the producer', async () => {
      const producer = makeProducer();
      const kafka    = makeKafka(producer);
      const logger   = makeLogger();
      const service  = new KafkaProducerService(kafka as any, logger as any);

      await service.onApplicationBootstrap();

      expect(producer.connect).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith('Kafka producer connected', 'KafkaProducerService');
    });
  });

  describe('onApplicationShutdown()', () => {
    it('disconnects the producer', async () => {
      const producer = makeProducer();
      const kafka    = makeKafka(producer);
      const logger   = makeLogger();
      const service  = new KafkaProducerService(kafka as any, logger as any);

      await service.onApplicationShutdown();

      expect(producer.disconnect).toHaveBeenCalled();
      expect(logger.log).toHaveBeenCalledWith('Kafka producer disconnected', 'KafkaProducerService');
    });
  });

  // ── emit() ────────────────────────────────────────────────────────────────

  describe('emit()', () => {
    it('sends a message to the given topic with JSON-serialised payload', async () => {
      const producer = makeProducer();
      const kafka    = makeKafka(producer);
      const logger   = makeLogger();
      const service  = new KafkaProducerService(kafka as any, logger as any);

      const payload = { orgId: 'org-1', typologyId: 'typo-abc', event: 'document.uploaded' };
      await service.emit('document-events', payload);

      expect(producer.send).toHaveBeenCalledWith({
        topic: 'document-events',
        messages: [
          expect.objectContaining({
            value:   JSON.stringify(payload),
            headers: expect.objectContaining({
              'x-correlation-id': 'kafka-correlation-id',
              'content-type':     'application/json',
            }),
          }),
        ],
      });
    });

    it('logs the kafka-produce event before sending', async () => {
      const producer = makeProducer();
      const kafka    = makeKafka(producer);
      const logger   = makeLogger();
      const service  = new KafkaProducerService(kafka as any, logger as any);

      await service.emit('test-topic', { foo: 'bar' });

      expect(logger.http).toHaveBeenCalledWith(
        expect.objectContaining({
          type:          'kafka-produce',
          topic:         'test-topic',
          correlationId: 'kafka-correlation-id',
        }),
      );
    });

    it('propagates errors from producer.send()', async () => {
      const producer = makeProducer();
      producer.send.mockRejectedValue(new Error('Kafka broker unreachable'));
      const kafka   = makeKafka(producer);
      const logger  = makeLogger();
      const service = new KafkaProducerService(kafka as any, logger as any);

      await expect(service.emit('topic', {})).rejects.toThrow('Kafka broker unreachable');
    });

    it('serialises nested objects correctly', async () => {
      const producer = makeProducer();
      const kafka    = makeKafka(producer);
      const logger   = makeLogger();
      const service  = new KafkaProducerService(kafka as any, logger as any);

      const payload = { nested: { key: 'value' }, arr: [1, 2, 3] };
      await service.emit('events', payload);

      const sentValue = producer.send.mock.calls[0][0].messages[0].value;
      expect(JSON.parse(sentValue)).toEqual(payload);
    });
  });
});

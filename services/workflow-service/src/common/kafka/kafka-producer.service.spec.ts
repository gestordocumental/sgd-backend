import { Kafka, Producer } from 'kafkajs';
import { KafkaProducerService } from './kafka-producer.service';
import { AppLogger } from '../logger/app-logger.service';

function makeProducer(): jest.Mocked<Producer> {
  return {
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    send: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Producer>;
}

function makeKafka(producer: Producer): jest.Mocked<Kafka> {
  return {
    producer: jest.fn().mockReturnValue(producer),
  } as unknown as jest.Mocked<Kafka>;
}

function makeLogger(): jest.Mocked<AppLogger> {
  return {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    http: jest.fn(),
  } as unknown as jest.Mocked<AppLogger>;
}

const flushAsync = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('KafkaProducerService', () => {
  let producer: jest.Mocked<Producer>;
  let kafka: jest.Mocked<Kafka>;
  let logger: jest.Mocked<AppLogger>;
  let service: KafkaProducerService;

  beforeEach(() => {
    producer = makeProducer();
    kafka = makeKafka(producer);
    logger = makeLogger();
    service = new KafkaProducerService(kafka, logger);
  });

  describe('onApplicationBootstrap()', () => {
    it('connects the producer', async () => {
      await service.onApplicationBootstrap();
      expect(producer.connect).toHaveBeenCalled();
    });

    it('logs connection success', async () => {
      await service.onApplicationBootstrap();
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('connected'),
        expect.any(String),
      );
    });
  });

  describe('onApplicationShutdown()', () => {
    it('disconnects the producer', async () => {
      await service.onApplicationShutdown();
      expect(producer.disconnect).toHaveBeenCalled();
    });

    it('logs disconnection', async () => {
      await service.onApplicationShutdown();
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('disconnected'),
        expect.any(String),
      );
    });
  });

  describe('emit()', () => {
    it('sends the message to the correct topic', async () => {
      const payload = { workflowId: 'wf-1', event: 'CREATED' };
      await service.emit('workflow.created', payload);

      expect(producer.send).toHaveBeenCalledWith(
        expect.objectContaining({
          topic: 'workflow.created',
          messages: expect.arrayContaining([
            expect.objectContaining({ value: JSON.stringify(payload) }),
          ]),
        }),
      );
    });

    it('includes x-correlation-id header', async () => {
      await service.emit('some.topic', {});

      const sendCall = (producer.send as jest.Mock).mock.calls[0][0];
      expect(sendCall.messages[0].headers).toHaveProperty('x-correlation-id');
    });

    it('logs the outgoing message', async () => {
      await service.emit('workflow.created', { id: 1 });
      expect(logger.http).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'kafka-produce', topic: 'workflow.created' }),
      );
    });
  });

  describe('emitSafe()', () => {
    it('fires and forgets without throwing', () => {
      expect(() => service.emitSafe('some.topic', { id: 1 })).not.toThrow();
    });

    it('logs an error when emit fails', async () => {
      producer.send.mockRejectedValueOnce(new Error('Kafka unavailable'));
      service.emitSafe('some.topic', { id: 1 });
      await flushAsync();

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to emit'),
        expect.any(String),
      );
    });

    it('handles non-Error rejections', async () => {
      producer.send.mockRejectedValueOnce('string error');
      service.emitSafe('some.topic', {});
      await flushAsync();
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

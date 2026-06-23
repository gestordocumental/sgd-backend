import { Test, TestingModule } from '@nestjs/testing';
import { KafkaProducerService, AppLogger, KAFKA_CLIENT } from '@sgd/common';

jest.mock('@sgd/common/correlation/correlation.context', () => ({
  getCorrelationId: jest.fn().mockReturnValue('kafka-correlation-id'),
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

const mockProducer = {
  connect: jest.fn(),
  disconnect: jest.fn(),
  send: jest.fn(),
};

const mockKafka = {
  producer: jest.fn(() => mockProducer),
};

// ─── Suite ──────────────────────────────────────────────────────────────────

describe('KafkaProducerService', () => {
  let service: KafkaProducerService;
  let mockLogger: jest.Mocked<AppLogger>;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockLogger = {
      log: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      http: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KafkaProducerService,
        {
          provide: KAFKA_CLIENT,
          useValue: mockKafka,
        },
        {
          provide: AppLogger,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get(KafkaProducerService);
  });

  // ─── Constructor ──────────────────────────────────────────────────────────

  it('creates a producer from the injected Kafka client', () => {
    expect(mockKafka.producer).toHaveBeenCalledTimes(1);
  });

  // ─── onApplicationBootstrap ───────────────────────────────────────────────

  describe('onApplicationBootstrap()', () => {
    it('connects the producer', async () => {
      mockProducer.connect.mockResolvedValue(undefined);

      await service.onApplicationBootstrap();

      expect(mockProducer.connect).toHaveBeenCalledTimes(1);
    });

    it('logs a confirmation message after connecting', async () => {
      mockProducer.connect.mockResolvedValue(undefined);

      await service.onApplicationBootstrap();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Kafka producer connected',
        'KafkaProducerService',
      );
    });
  });

  // ─── onApplicationShutdown ────────────────────────────────────────────────

  describe('onApplicationShutdown()', () => {
    it('disconnects the producer', async () => {
      mockProducer.disconnect.mockResolvedValue(undefined);

      await service.onApplicationShutdown();

      expect(mockProducer.disconnect).toHaveBeenCalledTimes(1);
    });

    it('logs a confirmation message after disconnecting', async () => {
      mockProducer.disconnect.mockResolvedValue(undefined);

      await service.onApplicationShutdown();

      expect(mockLogger.log).toHaveBeenCalledWith(
        'Kafka producer disconnected',
        'KafkaProducerService',
      );
    });
  });

  // ─── emit ─────────────────────────────────────────────────────────────────

  describe('emit()', () => {
    it('sends a message to the correct topic', async () => {
      mockProducer.send.mockResolvedValue([{ topicName: 'user.invited', partition: 0 }]);
      const payload = { userId: 'user-1', email: 'test@example.com' };

      await service.emit('user.invited', payload);

      expect(mockProducer.send).toHaveBeenCalledWith(
        expect.objectContaining({ topic: 'user.invited' }),
      );
    });

    it('serialises the payload as JSON in the message value', async () => {
      mockProducer.send.mockResolvedValue([]);
      const payload = { userId: 'user-1', email: 'test@example.com' };

      await service.emit('user.invited', payload);

      const sentMessage = mockProducer.send.mock.calls[0][0];
      expect(sentMessage.messages[0].value).toBe(JSON.stringify(payload));
    });

    it('injects the x-correlation-id header into the Kafka message', async () => {
      mockProducer.send.mockResolvedValue([]);

      await service.emit('user.invited', {});

      const sentMessage = mockProducer.send.mock.calls[0][0];
      expect(sentMessage.messages[0].headers['x-correlation-id']).toBe('kafka-correlation-id');
    });

    it('sets the content-type header to application/json', async () => {
      mockProducer.send.mockResolvedValue([]);

      await service.emit('some.topic', { key: 'value' });

      const sentMessage = mockProducer.send.mock.calls[0][0];
      expect(sentMessage.messages[0].headers['content-type']).toBe('application/json');
    });

    it('logs a kafka-produce http event', async () => {
      mockProducer.send.mockResolvedValue([]);

      await service.emit('user.updated', { userId: 'u1' });

      expect(mockLogger.http).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'kafka-produce',
          topic: 'user.updated',
          correlationId: 'kafka-correlation-id',
        }),
      );
    });

    it('propagates producer errors to the caller', async () => {
      mockProducer.send.mockRejectedValue(new Error('Kafka broker unavailable'));

      await expect(service.emit('user.invited', {})).rejects.toThrow(
        'Kafka broker unavailable',
      );
    });

    it('handles complex nested payload objects correctly', async () => {
      mockProducer.send.mockResolvedValue([]);
      const complexPayload = { user: { id: 'u1', roles: ['admin', 'viewer'] }, ts: 1234567890 };

      await service.emit('user.created', complexPayload);

      const sentMessage = mockProducer.send.mock.calls[0][0];
      expect(JSON.parse(sentMessage.messages[0].value)).toEqual(complexPayload);
    });
  });
});

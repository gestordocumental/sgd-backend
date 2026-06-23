import { ConfigService } from '@nestjs/config';
import { AuditConsumer } from './audit.consumer';
import { AuditService } from './audit.service';
import { AppLogger, KafkaProducerService, TOPICS } from '@sgd/common';

// runWithCorrelation → passthrough so handleMessage is exercised directly.
// withDlt → single-attempt passthrough that routes to DLT on error (mirrors
//           real behavior without actual retry delays).
jest.mock('@sgd/common', () => ({
  ...jest.requireActual('@sgd/common'),
  runWithCorrelation: jest.fn((_msg: unknown, fn: () => Promise<void>) => fn()),
  withDlt: jest.fn(async ({ producer, topic, message }: any, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      await producer.emitToDlt(topic, message).catch(() => {});
    }
  }),
}));

// ── helpers ────────────────────────────────────────────────────────────────

function makeMsg(value: string | null) {
  return {
    topic:     TOPICS.AUDIT_LOG,
    partition: 0,
    message: {
      value:     value !== null ? Buffer.from(value) : null,
      headers:   {},
      offset:    '0',
      timestamp: String(Date.now()),
    },
  };
}

const validEvent = {
  service:      'workflow-service',
  actorId:      'actor-1',
  orgId:        'org-1',
  action:       'WORKFLOW_CREATED',
  resourceType: 'workflow',
  resourceId:   'res-1',
  metadata:     null,
  timestamp:    '2024-01-01T00:00:00Z',
};

// ── describe ───────────────────────────────────────────────────────────────

describe('AuditConsumer', () => {
  let consumer: AuditConsumer;
  let mockKafkaConsumer: any;
  let capturedEachMessage: ((payload: any) => Promise<void>);

  let auditService: jest.Mocked<Pick<AuditService, 'index'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'log' | 'warn' | 'error' | 'http'>>;
  let config: jest.Mocked<Pick<ConfigService, 'getOrThrow'>>;
  let mockProducer: jest.Mocked<Pick<KafkaProducerService, 'emitToDlt'>>;

  beforeEach(async () => {
    mockKafkaConsumer = {
      connect:    jest.fn().mockResolvedValue(undefined),
      subscribe:  jest.fn().mockResolvedValue(undefined),
      run:        jest.fn().mockImplementation(({ eachMessage }) => {
        capturedEachMessage = eachMessage;
        return Promise.resolve();
      }),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };

    const mockKafka = { consumer: jest.fn().mockReturnValue(mockKafkaConsumer) };

    config       = { getOrThrow: jest.fn().mockReturnValue('audit-consumer-group') };
    auditService = { index: jest.fn().mockResolvedValue(undefined) };
    logger       = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn() };
    mockProducer = { emitToDlt: jest.fn().mockResolvedValue(undefined) };

    consumer = new AuditConsumer(
      mockKafka as any,
      config as any,
      auditService as any,
      logger as any,
      mockProducer as any,
    );

    await consumer.onApplicationBootstrap();
  });

  // ── lifecycle ─────────────────────────────────────────────────────────────

  it('connects, subscribes to audit.log and starts run on bootstrap', () => {
    expect(mockKafkaConsumer.connect).toHaveBeenCalledTimes(1);
    expect(mockKafkaConsumer.subscribe).toHaveBeenCalledWith({
      topics:        [TOPICS.AUDIT_LOG],
      fromBeginning: false,
    });
    expect(mockKafkaConsumer.run).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining(TOPICS.AUDIT_LOG),
      'AuditConsumer',
    );
  });

  it('creates consumer with connection-level retry config', async () => {
    const mockKafka = { consumer: jest.fn().mockReturnValue(mockKafkaConsumer) };
    const c = new AuditConsumer(mockKafka as any, config as any, auditService as any, logger as any, mockProducer as any);
    await c.onApplicationBootstrap();
    expect(mockKafka.consumer).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: expect.any(String),
        retry: expect.any(Object),
      }),
    );
  });

  it('uses the configured consumer group id', () => {
    expect(config.getOrThrow).toHaveBeenCalledWith('KAFKA_CONSUMER_GROUP');
  });

  it('disconnects on application shutdown', async () => {
    await consumer.onApplicationShutdown();

    expect(mockKafkaConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('disconnected'),
      'AuditConsumer',
    );
  });

  // ── handleMessage — null value ────────────────────────────────────────────

  it('ignores messages with null value', async () => {
    await capturedEachMessage(makeMsg(null));

    expect(auditService.index).not.toHaveBeenCalled();
  });

  // ── handleMessage — malformed JSON ────────────────────────────────────────

  it('warns and skips malformed JSON', async () => {
    await capturedEachMessage(makeMsg('not-valid-json{'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Malformed JSON'),
      'AuditConsumer',
    );
    expect(auditService.index).not.toHaveBeenCalled();
  });

  // ── handleMessage — invalid payload ───────────────────────────────────────

  it('warns and skips payload missing required fields', async () => {
    const bad = { service: 'x', actorId: 'a' };

    await capturedEachMessage(makeMsg(JSON.stringify(bad)));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid audit.log payload'),
      'AuditConsumer',
    );
    expect(auditService.index).not.toHaveBeenCalled();
  });

  it('warns and skips non-object payloads', async () => {
    await capturedEachMessage(makeMsg(JSON.stringify(42)));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid audit.log payload'),
      'AuditConsumer',
    );
  });

  it('logs keys of invalid payload for debugging', async () => {
    const partial = { service: 'svc', actorId: 'actor' };

    await capturedEachMessage(makeMsg(JSON.stringify(partial)));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/keys=.*service.*actorId/),
      'AuditConsumer',
    );
  });

  // ── handleMessage — valid payload ─────────────────────────────────────────

  it('indexes a valid audit log event', async () => {
    await capturedEachMessage(makeMsg(JSON.stringify(validEvent)));

    expect(auditService.index).toHaveBeenCalledWith(validEvent);
  });

  it('indexes event with optional fields (resourceName, correlationId, ip)', async () => {
    const withOptionals = {
      ...validEvent,
      resourceName:  'My Workflow',
      correlationId: 'corr-123',
      ip:            '10.0.0.1',
    };

    await capturedEachMessage(makeMsg(JSON.stringify(withOptionals)));

    expect(auditService.index).toHaveBeenCalledWith(withOptionals);
  });

  it('logs http consume event before indexing', async () => {
    await capturedEachMessage(makeMsg(JSON.stringify(validEvent)));

    expect(logger.http).toHaveBeenCalledWith(
      expect.objectContaining({ topic: TOPICS.AUDIT_LOG }),
    );
  });

  // ── DLT routing on handler error ──────────────────────────────────────────

  it('routes message to DLT and does not re-throw on indexing error', async () => {
    auditService.index.mockRejectedValue(new Error('ES write failed'));

    // Must resolve — offset is advanced; the message goes to DLT instead
    await expect(
      capturedEachMessage(makeMsg(JSON.stringify(validEvent))),
    ).resolves.toBeUndefined();

    expect(mockProducer.emitToDlt).toHaveBeenCalledWith(
      TOPICS.AUDIT_LOG,
      expect.objectContaining({ value: expect.any(Buffer) }),
    );
  });

  it('routes message to DLT topic derived from the original topic', async () => {
    auditService.index.mockRejectedValue(new Error('down'));

    await capturedEachMessage(makeMsg(JSON.stringify(validEvent)));

    const [routedTopic] = mockProducer.emitToDlt.mock.calls[0];
    expect(routedTopic).toBe(TOPICS.AUDIT_LOG);
  });
});

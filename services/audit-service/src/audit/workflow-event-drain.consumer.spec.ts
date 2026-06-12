import { ConfigService } from '@nestjs/config';
import { WorkflowEventDrainConsumer } from './workflow-event-drain.consumer';
import { AppLogger, KafkaProducerService, TOPICS } from '@sgd/common';

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

function makeMsg(topic: string, value: string | null) {
  return {
    topic,
    partition: 0,
    message: {
      value:     value !== null ? Buffer.from(value) : null,
      headers:   {},
      offset:    '0',
      timestamp: String(Date.now()),
    },
  };
}

describe('WorkflowEventDrainConsumer', () => {
  let consumer:             WorkflowEventDrainConsumer;
  let mockKafka:            { consumer: jest.Mock };
  let mockKafkaConsumer:    any;
  let capturedEachMessage:  (payload: any) => Promise<void>;

  let config:       jest.Mocked<Pick<ConfigService, 'getOrThrow'>>;
  let logger:       jest.Mocked<Pick<AppLogger, 'log' | 'warn' | 'debug'>>;
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

    mockKafka    = { consumer: jest.fn().mockReturnValue(mockKafkaConsumer) };
    config       = { getOrThrow: jest.fn().mockReturnValue('test-group') };
    logger       = { log: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    mockProducer = { emitToDlt: jest.fn().mockResolvedValue(undefined) };

    consumer = new WorkflowEventDrainConsumer(
      mockKafka as any,
      config as any,
      logger as any,
      mockProducer as any,
    );

    await consumer.onApplicationBootstrap();
  });

  // ── lifecycle ──────────────────────────────────────────────────────────────

  it('connects, subscribes to all 13 drain topics and starts run on bootstrap', () => {
    expect(mockKafkaConsumer.connect).toHaveBeenCalledTimes(1);
    expect(mockKafkaConsumer.run).toHaveBeenCalledTimes(1);

    const { topics, fromBeginning } = mockKafkaConsumer.subscribe.mock.calls[0][0];
    expect(fromBeginning).toBe(false);
    expect(topics).toHaveLength(13);
    expect(topics).toContain(TOPICS.WORKFLOW_CREATED);
    expect(topics).toContain(TOPICS.WORKFLOW_CANCELLED);
    expect(topics).toContain(TOPICS.WORKFLOW_CLOSED);
  });

  it('uses KAFKA_CONSUMER_GROUP with -workflow-drain suffix as group id', () => {
    expect(config.getOrThrow).toHaveBeenCalledWith('KAFKA_CONSUMER_GROUP');
    expect(mockKafka.consumer).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'test-group-workflow-drain' }),
    );
  });

  it('configures retry on the kafka consumer', () => {
    expect(mockKafka.consumer).toHaveBeenCalledWith(
      expect.objectContaining({ retry: expect.any(Object) }),
    );
  });

  it('logs a connected message on bootstrap', () => {
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('drain'),
      'WorkflowEventDrainConsumer',
    );
  });

  it('disconnects and logs on shutdown', async () => {
    await consumer.onApplicationShutdown();

    expect(mockKafkaConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('disconnected'),
      'WorkflowEventDrainConsumer',
    );
  });

  // ── handleMessage — null value ─────────────────────────────────────────────

  it('ignores messages with null value', async () => {
    await capturedEachMessage(makeMsg(TOPICS.WORKFLOW_CREATED, null));

    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  // ── handleMessage — valid JSON ─────────────────────────────────────────────

  it('logs debug including workflowId when present', async () => {
    await capturedEachMessage(
      makeMsg(TOPICS.WORKFLOW_CREATED, JSON.stringify({ workflowId: 'wf-123' })),
    );

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('workflowId=wf-123'),
      'WorkflowEventDrainConsumer',
    );
  });

  it('logs debug without workflowId when field is absent', async () => {
    await capturedEachMessage(
      makeMsg(TOPICS.WORKFLOW_APPROVAL_APPROVED, JSON.stringify({ status: 'approved' })),
    );

    expect(logger.debug).toHaveBeenCalledWith(
      expect.not.stringContaining('workflowId='),
      'WorkflowEventDrainConsumer',
    );
  });

  it('ignores non-string workflowId values', async () => {
    await capturedEachMessage(
      makeMsg(TOPICS.WORKFLOW_CREATED, JSON.stringify({ workflowId: 42 })),
    );

    expect(logger.debug).toHaveBeenCalledWith(
      expect.not.stringContaining('workflowId='),
      'WorkflowEventDrainConsumer',
    );
  });

  it('includes the topic name in the debug log', async () => {
    await capturedEachMessage(
      makeMsg(TOPICS.WORKFLOW_CLOSED, JSON.stringify({ workflowId: 'wf-99' })),
    );

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining(TOPICS.WORKFLOW_CLOSED),
      'WorkflowEventDrainConsumer',
    );
  });

  // ── handleMessage — malformed JSON ─────────────────────────────────────────

  it('warns and does not debug-log for malformed JSON', async () => {
    await capturedEachMessage(makeMsg(TOPICS.WORKFLOW_CREATED, '{not-valid-json'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Malformed JSON'),
      'WorkflowEventDrainConsumer',
    );
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('includes the topic name in the malformed JSON warning', async () => {
    await capturedEachMessage(makeMsg(TOPICS.WORKFLOW_CANCELLED, 'bad'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(TOPICS.WORKFLOW_CANCELLED),
      'WorkflowEventDrainConsumer',
    );
  });

  // ── DLT routing ────────────────────────────────────────────────────────────

  it('routes message to DLT and does not rethrow when handler throws', async () => {
    (logger.debug as jest.Mock).mockImplementationOnce(() => {
      throw new Error('unexpected logger failure');
    });

    await expect(
      capturedEachMessage(makeMsg(TOPICS.WORKFLOW_CREATED, JSON.stringify({ workflowId: 'wf-1' }))),
    ).resolves.toBeUndefined();

    expect(mockProducer.emitToDlt).toHaveBeenCalledWith(
      TOPICS.WORKFLOW_CREATED,
      expect.objectContaining({ value: expect.any(Buffer) }),
    );
  });
});

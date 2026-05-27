import { ConfigService } from '@nestjs/config';
import { NotificationsConsumer } from './notifications.consumer';
import { NotificationsService } from './notifications.service';
import { EmailService } from './email/email.service';
import { AppLogger } from '../common/logger/app-logger.service';
import { TOPICS } from '../common/kafka/kafka.constants';

// Make runWithCorrelation a passthrough so handleMessage is exercised directly
jest.mock('../common/kafka/kafka-consumer.util', () => ({
  runWithCorrelation: jest.fn((_msg: unknown, fn: () => Promise<void>) => fn()),
}));

// ── helpers ────────────────────────────────────────────────────────────────

function makeMsg(topic: string, value: string | null) {
  return {
    topic,
    partition: 0,
    message: {
      value: value !== null ? Buffer.from(value) : null,
      headers:   {},
      offset:    '0',
      timestamp: String(Date.now()),
    },
  };
}

const validNotificationPayload = {
  type:             'WORKFLOW_APPROVED',
  recipientUserIds: ['user-1', 'user-2'],
  message:          'Aprobado',
  workflowId:       'wf-uuid',
  workflowTitle:    'WF Test',
};

const validInvitePayload = {
  userId:          'user-id-1',
  email:           'user@test.com',
  invitationToken: 'token-abc',
  expiresAt:       '2025-12-31T00:00:00Z',
};

// ── describe ───────────────────────────────────────────────────────────────

describe('NotificationsConsumer', () => {
  let consumer: NotificationsConsumer;
  let mockKafkaConsumer: any;
  let capturedEachMessage: ((payload: any) => Promise<void>);

  let notificationsService: jest.Mocked<Pick<NotificationsService, 'dispatch'>>;
  let emailService: jest.Mocked<Pick<EmailService, 'sendInvitation'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'log' | 'warn' | 'error' | 'http'>>;
  let config: jest.Mocked<Pick<ConfigService, 'getOrThrow'>>;

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

    config             = { getOrThrow: jest.fn().mockReturnValue('test-consumer-group') };
    notificationsService = { dispatch: jest.fn().mockResolvedValue(undefined) };
    emailService       = { sendInvitation: jest.fn().mockResolvedValue(undefined) };
    logger             = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn() };

    consumer = new NotificationsConsumer(
      mockKafka as any,
      config as any,
      notificationsService as any,
      emailService as any,
      logger as any,
    );

    await consumer.onApplicationBootstrap();
  });

  // ── lifecycle ────────────────────────────────────────────────────────────

  it('connects, subscribes to both topics and starts run on bootstrap', () => {
    expect(mockKafkaConsumer.connect).toHaveBeenCalledTimes(1);
    expect(mockKafkaConsumer.subscribe).toHaveBeenCalledWith({
      topics: [TOPICS.NOTIFICATION_SEND, TOPICS.USER_INVITED],
      fromBeginning: false,
    });
    expect(mockKafkaConsumer.run).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('Kafka consumer connected'),
      'NotificationsConsumer',
    );
  });

  it('disconnects on application shutdown', async () => {
    await consumer.onApplicationShutdown();

    expect(mockKafkaConsumer.disconnect).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('disconnected'),
      'NotificationsConsumer',
    );
  });

  // ── handleMessage — null value ────────────────────────────────────────────

  it('ignores messages with null value', async () => {
    await capturedEachMessage(makeMsg(TOPICS.NOTIFICATION_SEND, null));

    expect(notificationsService.dispatch).not.toHaveBeenCalled();
    expect(emailService.sendInvitation).not.toHaveBeenCalled();
  });

  // ── handleMessage — malformed JSON ────────────────────────────────────────

  it('warns and skips on malformed JSON', async () => {
    await capturedEachMessage(makeMsg(TOPICS.NOTIFICATION_SEND, 'not-json{'));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Malformed JSON'),
      'NotificationsConsumer',
    );
    expect(notificationsService.dispatch).not.toHaveBeenCalled();
  });

  // ── handleMessage — notification.send ────────────────────────────────────

  it('dispatches valid notification.send payload', async () => {
    await capturedEachMessage(makeMsg(TOPICS.NOTIFICATION_SEND, JSON.stringify(validNotificationPayload)));

    expect(notificationsService.dispatch).toHaveBeenCalledWith({
      type:             'WORKFLOW_APPROVED',
      recipientUserIds: ['user-1', 'user-2'],
      message:          'Aprobado',
      orgId:            null,
      orgName:          null,
      workflowId:       'wf-uuid',
      workflowTitle:    'WF Test',
      metadata:         undefined,
    });
  });

  it('dispatches without optional workflowId/workflowTitle', async () => {
    const minimal = { type: 'WORKFLOW_REJECTED', recipientUserIds: ['user-3'], message: 'Msg' };

    await capturedEachMessage(makeMsg(TOPICS.NOTIFICATION_SEND, JSON.stringify(minimal)));

    expect(notificationsService.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: null, workflowTitle: null }),
    );
  });

  it('warns and skips on invalid notification.send payload', async () => {
    // Missing recipientUserIds and message
    const bad = { type: 'WORKFLOW_APPROVED' };

    await capturedEachMessage(makeMsg(TOPICS.NOTIFICATION_SEND, JSON.stringify(bad)));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(`Invalid payload in ${TOPICS.NOTIFICATION_SEND}`),
      'NotificationsConsumer',
    );
    expect(notificationsService.dispatch).not.toHaveBeenCalled();
  });

  // ── handleMessage — user.invited ──────────────────────────────────────────

  it('sends invitation email for valid user.invited payload', async () => {
    await capturedEachMessage(makeMsg(TOPICS.USER_INVITED, JSON.stringify(validInvitePayload)));

    expect(emailService.sendInvitation).toHaveBeenCalledWith({
      to:              'user@test.com',
      invitationToken: 'token-abc',
      expiresAt:       '2025-12-31T00:00:00Z',
    });
    expect(notificationsService.dispatch).not.toHaveBeenCalled();
  });

  it('warns and skips on invalid user.invited payload', async () => {
    // Missing email, invitationToken, expiresAt
    const bad = { userId: 'user-1' };

    await capturedEachMessage(makeMsg(TOPICS.USER_INVITED, JSON.stringify(bad)));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid user.invited payload'),
      'NotificationsConsumer',
    );
    expect(emailService.sendInvitation).not.toHaveBeenCalled();
  });

  // ── error propagation ────────────────────────────────────────────────────

  it('re-throws errors so Kafka offset is not advanced', async () => {
    notificationsService.dispatch.mockRejectedValue(new Error('DB failure'));

    await expect(
      capturedEachMessage(makeMsg(TOPICS.NOTIFICATION_SEND, JSON.stringify(validNotificationPayload))),
    ).rejects.toThrow('DB failure');

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('DB failure'),
      expect.anything(),
      'NotificationsConsumer',
    );
  });

  it('re-throws errors from sendInvitation', async () => {
    emailService.sendInvitation.mockRejectedValue(new Error('Email API down'));

    await expect(
      capturedEachMessage(makeMsg(TOPICS.USER_INVITED, JSON.stringify(validInvitePayload))),
    ).rejects.toThrow('Email API down');
  });
});

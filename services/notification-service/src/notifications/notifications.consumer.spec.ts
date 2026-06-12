import { ConfigService } from '@nestjs/config';
import { NotificationsConsumer } from './notifications.consumer';
import { NotificationsService } from './notifications.service';
import { EmailService } from './email/email.service';
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
  let emailService: jest.Mocked<Pick<EmailService, 'sendInvitation' | 'sendPasswordReset'>>;
  let logger: jest.Mocked<Pick<AppLogger, 'log' | 'warn' | 'error' | 'http'>>;
  let config: jest.Mocked<Pick<ConfigService, 'getOrThrow'>>;
  let mockProducer: jest.Mocked<Pick<KafkaProducerService, 'emitToDlt'>>;
  let sseService: { emit: jest.Mock };

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

    config               = { getOrThrow: jest.fn().mockReturnValue('test-consumer-group') };
    notificationsService = { dispatch: jest.fn().mockResolvedValue(undefined) };
    emailService         = {
      sendInvitation:   jest.fn().mockResolvedValue(undefined),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
    };
    logger               = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn() };
    mockProducer         = { emitToDlt: jest.fn().mockResolvedValue(undefined) };

    sseService = { emit: jest.fn() };

    consumer = new NotificationsConsumer(
      mockKafka as any,
      config as any,
      notificationsService as any,
      sseService as any,
      emailService as any,
      logger as any,
      mockProducer as any,
    );

    await consumer.onApplicationBootstrap();
  });

  // ── lifecycle ────────────────────────────────────────────────────────────

  it('connects, subscribes to all topics and starts run on bootstrap', () => {
    expect(mockKafkaConsumer.connect).toHaveBeenCalledTimes(1);
    expect(mockKafkaConsumer.subscribe).toHaveBeenCalledWith({
      topics: [
        TOPICS.NOTIFICATION_SEND,
        TOPICS.USER_INVITED,
        TOPICS.USER_ORG_REMOVED,
        TOPICS.USER_SUPER_ADMIN_REVOKED,
        TOPICS.PASSWORD_RESET,
      ],
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
    const bad = { userId: 'user-1' };

    await capturedEachMessage(makeMsg(TOPICS.USER_INVITED, JSON.stringify(bad)));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid user.invited payload'),
      'NotificationsConsumer',
    );
    expect(emailService.sendInvitation).not.toHaveBeenCalled();
  });

  // ── DLT routing on handler error ──────────────────────────────────────────

  it('routes to DLT and does not re-throw when notification dispatch fails', async () => {
    notificationsService.dispatch.mockRejectedValue(new Error('DB failure'));

    // Must resolve — offset is advanced; the message goes to DLT instead
    await expect(
      capturedEachMessage(makeMsg(TOPICS.NOTIFICATION_SEND, JSON.stringify(validNotificationPayload))),
    ).resolves.toBeUndefined();

    expect(mockProducer.emitToDlt).toHaveBeenCalledWith(
      TOPICS.NOTIFICATION_SEND,
      expect.objectContaining({ value: expect.any(Buffer) }),
    );
  });

  it('routes to DLT and does not re-throw when sendInvitation fails', async () => {
    emailService.sendInvitation.mockRejectedValue(new Error('Email API down'));

    await expect(
      capturedEachMessage(makeMsg(TOPICS.USER_INVITED, JSON.stringify(validInvitePayload))),
    ).resolves.toBeUndefined();

    expect(mockProducer.emitToDlt).toHaveBeenCalledWith(
      TOPICS.USER_INVITED,
      expect.objectContaining({ value: expect.any(Buffer) }),
    );
  });

  // ── handleMessage — auth.password-reset ──────────────────────────────────

  it('sends password reset email for valid auth.password-reset payload', async () => {
    const payload = { email: 'user@test.com', resetToken: 'token-xyz', expiresAt: '2025-12-31T00:00:00Z' };

    await capturedEachMessage(makeMsg(TOPICS.PASSWORD_RESET, JSON.stringify(payload)));

    expect(emailService.sendPasswordReset).toHaveBeenCalledWith({
      to:         'user@test.com',
      resetToken: 'token-xyz',
      expiresAt:  '2025-12-31T00:00:00Z',
    });
    expect(notificationsService.dispatch).not.toHaveBeenCalled();
  });

  it('warns and skips on invalid auth.password-reset payload', async () => {
    const bad = { email: 'user@test.com' }; // missing resetToken and expiresAt

    await capturedEachMessage(makeMsg(TOPICS.PASSWORD_RESET, JSON.stringify(bad)));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid auth.password-reset payload'),
      'NotificationsConsumer',
    );
    expect(emailService.sendPasswordReset).not.toHaveBeenCalled();
  });

  it('routes to DLT and does not re-throw when sendPasswordReset fails', async () => {
    emailService.sendPasswordReset.mockRejectedValue(new Error('SMTP error'));
    const payload = { email: 'user@test.com', resetToken: 'token-xyz', expiresAt: '2025-12-31T00:00:00Z' };

    await expect(
      capturedEachMessage(makeMsg(TOPICS.PASSWORD_RESET, JSON.stringify(payload))),
    ).resolves.toBeUndefined();

    expect(mockProducer.emitToDlt).toHaveBeenCalledWith(
      TOPICS.PASSWORD_RESET,
      expect.objectContaining({ value: expect.any(Buffer) }),
    );
  });

  // ── handleMessage — user.org-removed ─────────────────────────────────────

  it('emits session-revoked SSE event for valid user.org-removed payload', async () => {
    const payload = { userId: 'user-42', orgId: 'org-99' };

    await capturedEachMessage(makeMsg(TOPICS.USER_ORG_REMOVED, JSON.stringify(payload)));

    expect(sseService.emit).toHaveBeenCalledWith('user-42', { orgId: 'org-99' }, 'session-revoked');
    expect(notificationsService.dispatch).not.toHaveBeenCalled();
  });

  it('warns and skips on invalid user.org-removed payload (missing orgId)', async () => {
    const bad = { userId: 'user-42' }; // missing orgId

    await capturedEachMessage(makeMsg(TOPICS.USER_ORG_REMOVED, JSON.stringify(bad)));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid user.org-removed payload'),
      'NotificationsConsumer',
    );
    expect(sseService.emit).not.toHaveBeenCalled();
  });

  // ── handleMessage — user.super-admin-revoked ──────────────────────────────

  it('emits super-admin-revoked SSE event for valid user.super-admin-revoked payload', async () => {
    const payload = { userId: 'admin-1' };

    await capturedEachMessage(makeMsg(TOPICS.USER_SUPER_ADMIN_REVOKED, JSON.stringify(payload)));

    expect(sseService.emit).toHaveBeenCalledWith('admin-1', {}, 'super-admin-revoked');
    expect(notificationsService.dispatch).not.toHaveBeenCalled();
  });

  it('warns and skips on invalid user.super-admin-revoked payload (missing userId)', async () => {
    const bad = {}; // missing userId

    await capturedEachMessage(makeMsg(TOPICS.USER_SUPER_ADMIN_REVOKED, JSON.stringify(bad)));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Invalid user.super-admin-revoked payload'),
      'NotificationsConsumer',
    );
    expect(sseService.emit).not.toHaveBeenCalled();
  });
});

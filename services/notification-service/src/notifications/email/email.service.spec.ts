import { ConfigService } from '@nestjs/config';
import { EmailService, getNotificationTitle } from './email.service';
import { AppLogger } from '../../common/logger/app-logger.service';
import { NotificationType } from '../entities/notification.entity';

// ── global fetch mock ──────────────────────────────────────────────────────
const fetchMock = jest.fn();
(global as any).fetch = fetchMock;

// ── helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<Record<string, string | undefined>> = {}): jest.Mocked<ConfigService> {
  const defaults: Record<string, string> = {
    RESEND_API_KEY: 'test-api-key',
    RESEND_FROM:    'SGD Test <test@example.com>',
    FRONTEND_URL:   'https://app.example.com',
  };
  return {
    get: jest.fn().mockImplementation((key: string) => key in overrides ? overrides[key] : defaults[key]),
  } as any;
}

function makeLogger(): jest.Mocked<AppLogger> {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn() } as any;
}

function okFetch(body: object = { id: 'msg-1' }) {
  return { ok: true, status: 200, json: async () => body };
}

function failFetch(status: number, body: object) {
  return { ok: false, status, json: async () => body };
}

// ── getNotificationTitle ───────────────────────────────────────────────────

describe('getNotificationTitle', () => {
  const cases: Array<[NotificationType, string]> = [
    ['WORKFLOW_TASK_ASSIGNED',  'Nueva tarea de aprobación pendiente'],
    ['WORKFLOW_APPROVED',       'Workflow aprobado'],
    ['WORKFLOW_REJECTED',       'Workflow rechazado'],
    ['ADMIN_CYCLE_TASK',        'Nueva tarea administrativa pendiente'],
    ['ADMIN_CYCLE_COMPLETED',   'Ciclo administrativo completado'],
    ['WORKFLOW_CLOSED',         'Workflow cerrado'],
    ['NO_FINAL_USER_ALERT',     'Alerta: tipología sin usuarios asignados'],
  ];

  it.each(cases)('returns correct title for %s', (type, expected) => {
    expect(getNotificationTitle(type)).toBe(expected);
  });
});

// ── EmailService ───────────────────────────────────────────────────────────

describe('EmailService', () => {
  let logger: jest.Mocked<AppLogger>;

  beforeEach(() => {
    logger = makeLogger();
    fetchMock.mockReset();
  });

  // ── constructor ──────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('warns when RESEND_API_KEY is not set', () => {
      new EmailService(makeConfig({ RESEND_API_KEY: undefined }), logger);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('RESEND_API_KEY not set'),
        'EmailService',
      );
    });

    it('does not warn when RESEND_API_KEY is set', () => {
      new EmailService(makeConfig(), logger);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // ── sendNotification ─────────────────────────────────────────────────────

  describe('sendNotification', () => {
    it('returns early without calling fetch when email is disabled', async () => {
      const svc = new EmailService(makeConfig({ RESEND_API_KEY: undefined }), logger);

      await svc.sendNotification({ to: 'a@b.com', type: 'WORKFLOW_APPROVED', message: 'Test' });

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sends email successfully and logs success', async () => {
      fetchMock.mockResolvedValue(okFetch());
      const svc = new EmailService(makeConfig(), logger);

      await svc.sendNotification({ to: 'user@test.com', type: 'WORKFLOW_REJECTED', message: 'Rechazado' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('user@test.com'),
        'EmailService',
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('logs error when HTTP response is not ok (message field)', async () => {
      fetchMock.mockResolvedValue(failFetch(429, { message: 'Rate limit exceeded' }));
      const svc = new EmailService(makeConfig(), logger);

      await svc.sendNotification({ to: 'u@t.com', type: 'WORKFLOW_APPROVED', message: 'msg' });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded'),
        undefined,
        'EmailService',
      );
    });

    it('logs error using name field when message is absent', async () => {
      fetchMock.mockResolvedValue(failFetch(400, { name: 'validation_error' }));
      const svc = new EmailService(makeConfig(), logger);

      await svc.sendNotification({ to: 'u@t.com', type: 'WORKFLOW_APPROVED', message: 'msg' });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('validation_error'),
        undefined,
        'EmailService',
      );
    });

    it('falls back to HTTP status when both message and name are absent', async () => {
      fetchMock.mockResolvedValue(failFetch(503, {}));
      const svc = new EmailService(makeConfig(), logger);

      await svc.sendNotification({ to: 'u@t.com', type: 'WORKFLOW_APPROVED', message: 'msg' });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('HTTP 503'),
        undefined,
        'EmailService',
      );
    });

    it('includes workflowTitle in the email body HTML', async () => {
      fetchMock.mockResolvedValue(okFetch());
      const svc = new EmailService(makeConfig(), logger);

      await svc.sendNotification({
        to: 'u@t.com',
        type: 'WORKFLOW_TASK_ASSIGNED',
        message: 'Mensaje de prueba',
        workflowTitle: 'Mi Workflow Especial',
        workflowId: 'wf-uuid',
      });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.html).toContain('Mi Workflow Especial');
    });

    it('handles fetch network exception and logs error', async () => {
      fetchMock.mockRejectedValue(new Error('Network failure'));
      const svc = new EmailService(makeConfig(), logger);

      await svc.sendNotification({ to: 'u@t.com', type: 'WORKFLOW_APPROVED', message: 'msg' });

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Network failure'),
        undefined,
        'EmailService',
      );
    });
  });

  // ── sendInvitation ───────────────────────────────────────────────────────

  describe('sendInvitation', () => {
    const inviteOpts = {
      to:              'invited@test.com',
      invitationToken: 'tok-abc123',
      expiresAt:       '2024-12-31T00:00:00Z',
    };

    it('returns early and warns when email is disabled', async () => {
      const svc = new EmailService(makeConfig({ RESEND_API_KEY: undefined }), logger);

      await svc.sendInvitation(inviteOpts);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('invitation email not sent'),
        'EmailService',
      );
    });

    it('warns when FRONTEND_URL is not configured', async () => {
      const svc = new EmailService(makeConfig({ FRONTEND_URL: undefined }), logger);

      await svc.sendInvitation(inviteOpts);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('FRONTEND_URL not configured'),
        'EmailService',
      );
    });

    it('sends invitation email with token in body and logs success', async () => {
      fetchMock.mockResolvedValue(okFetch({ id: 'inv-1' }));
      const svc = new EmailService(makeConfig(), logger);

      await svc.sendInvitation(inviteOpts);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.html).toContain('tok-abc123');
      expect(body.to).toBe('invited@test.com');
      expect(logger.log).toHaveBeenCalledWith(
        expect.stringContaining('invited@test.com'),
        'EmailService',
      );
    });

    it('logs error when invitation email fails', async () => {
      fetchMock.mockResolvedValue(failFetch(500, { message: 'Internal error' }));
      const svc = new EmailService(makeConfig(), logger);

      await svc.sendInvitation(inviteOpts);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('invitation email'),
        undefined,
        'EmailService',
      );
    });

    it('handles fetch exception during invitation send', async () => {
      fetchMock.mockRejectedValue(new Error('Timeout'));
      const svc = new EmailService(makeConfig(), logger);

      await svc.sendInvitation(inviteOpts);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Timeout'),
        undefined,
        'EmailService',
      );
    });

    it('includes registration URL with token in HTML body', async () => {
      fetchMock.mockResolvedValue(okFetch());
      const svc = new EmailService(makeConfig(), logger);

      await svc.sendInvitation({ ...inviteOpts, invitationToken: 'special-token' });

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.html).toContain('complete-registration?token=special-token');
    });
  });
});

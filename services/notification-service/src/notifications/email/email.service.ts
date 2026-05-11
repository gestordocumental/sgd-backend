import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { AppLogger } from '../../common/logger/app-logger.service';
import { NotificationType } from '../entities/notification.entity';

const TITLES: Record<NotificationType, string> = {
  WORKFLOW_TASK_ASSIGNED:  'Nueva tarea de aprobación pendiente',
  WORKFLOW_APPROVED:       'Workflow aprobado',
  WORKFLOW_REJECTED:       'Workflow rechazado',
  ADMIN_CYCLE_TASK:        'Nueva tarea administrativa pendiente',
  ADMIN_CYCLE_COMPLETED:   'Ciclo administrativo completado',
  WORKFLOW_CLOSED:         'Workflow cerrado',
  NO_FINAL_USER_ALERT:     'Alerta: tipología sin usuarios asignados',
};

export function getNotificationTitle(type: NotificationType): string {
  return TITLES[type] ?? 'Nueva notificación';
}

@Injectable()
export class EmailService implements OnModuleInit {
  private transporter!: nodemailer.Transporter;
  private readonly from: string;
  private readonly enabled: boolean;
  private readonly frontendUrl: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: AppLogger,
  ) {
    this.from        = config.get<string>('SMTP_FROM') ?? 'SGD Helisa <no-reply@helisa.com>';
    const host       = config.get<string>('SMTP_HOST');
    this.enabled     = Boolean(host);
    this.frontendUrl = config.get<string>('FRONTEND_URL') ?? '';
  }

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('SMTP_HOST not set — email notifications disabled', 'EmailService');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host:   this.config.getOrThrow<string>('SMTP_HOST'),
      port:   Number(this.config.get<string>('SMTP_PORT') ?? 587),
      secure: this.config.get<string>('SMTP_SECURE') === 'true',
      auth: {
        user: this.config.get<string>('SMTP_USER') || undefined,
        pass: this.config.get<string>('SMTP_PASS') || undefined,
      },
    });

    this.logger.log('Email transporter initialized', 'EmailService');
  }

  async sendNotification(opts: {
    to: string;
    type: NotificationType;
    message: string;
    workflowTitle?: string | null;
    workflowId?: string | null;
  }): Promise<void> {
    if (!this.enabled) return;

    const subject = getNotificationTitle(opts.type);
    const html    = this.buildHtml(subject, opts.message, opts.workflowTitle);

    try {
      await this.transporter.sendMail({
        from:    this.from,
        to:      opts.to,
        subject,
        html,
      });
      this.logger.log(`Email sent to ${opts.to} [${opts.type}]`, 'EmailService');
    } catch (err) {
      this.logger.error(
        `Failed to send email to ${opts.to}: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        'EmailService',
      );
    }
  }

  async sendInvitation(opts: {
    to: string;
    invitationToken: string;
    expiresAt: string;
  }): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        `SMTP disabled — invitation email not sent to ${opts.to}. Token: ${opts.invitationToken}`,
        'EmailService',
      );
      return;
    }

    if (!this.frontendUrl) {
      this.logger.warn(
        'FRONTEND_URL not configured — cannot build invitation link. Email not sent.',
        'EmailService',
      );
      return;
    }

    const registrationUrl = `${this.frontendUrl}/complete-registration?token=${opts.invitationToken}`;
    const expiresDate     = new Date(opts.expiresAt).toLocaleString('es-CO', {
      timeZone: 'America/Bogota',
      dateStyle: 'long',
      timeStyle: 'short',
    });

    const subject = 'Bienvenido a SGD Helisa — Completa tu registro';
    const html    = this.buildInvitationHtml(registrationUrl, expiresDate);

    try {
      await this.transporter.sendMail({ from: this.from, to: opts.to, subject, html });
      this.logger.log(`Invitation email sent to ${opts.to}`, 'EmailService');
    } catch (err) {
      this.logger.error(
        `Failed to send invitation email to ${opts.to}: ${err instanceof Error ? err.message : String(err)}`,
        undefined,
        'EmailService',
      );
    }
  }

  private buildInvitationHtml(registrationUrl: string, expiresDate: string): string {
    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
          <!-- Header -->
          <tr>
            <td style="background:#1a56db;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">SGD Helisa</h1>
              <p style="margin:4px 0 0;color:#bfdbfe;font-size:13px;">Sistema de Gestión Documental</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 12px;color:#1e293b;font-size:20px;">¡Fuiste invitado a SGD Helisa!</h2>
              <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
                Un administrador ha creado una cuenta para ti en el Sistema de Gestión Documental.
                Para activar tu cuenta y configurar tu contraseña, haz clic en el botón a continuación.
              </p>
              <!-- CTA Button -->
              <table cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#1a56db;border-radius:6px;">
                    <a href="${registrationUrl}"
                       style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">
                      Completar registro
                    </a>
                  </td>
                </tr>
              </table>
              <!-- Fallback URL -->
              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;">
                Si el botón no funciona, copia y pega este enlace en tu navegador:
              </p>
              <p style="margin:0 0 20px;word-break:break-all;">
                <a href="${registrationUrl}" style="color:#1a56db;font-size:13px;">${registrationUrl}</a>
              </p>
              <!-- Expiry notice -->
              <p style="margin:0;padding:12px 16px;background:#fef9c3;border-radius:6px;color:#92400e;font-size:13px;">
                ⚠️ Este enlace expira el <strong>${expiresDate}</strong>.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">Este es un mensaje automático. Por favor no responda este correo.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private buildHtml(title: string, message: string, workflowTitle?: string | null): string {
    const workflowSection = workflowTitle
      ? `<p style="margin:16px 0;color:#555;font-size:14px;">
           <strong>Workflow:</strong> ${this.escapeHtml(workflowTitle)}
         </p>`
      : '';

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
          <!-- Header -->
          <tr>
            <td style="background:#1a56db;padding:24px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">SGD Helisa</h1>
              <p style="margin:4px 0 0;color:#bfdbfe;font-size:13px;">Sistema de Gestión Documental</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <h2 style="margin:0 0 16px;color:#1e293b;font-size:18px;">${this.escapeHtml(title)}</h2>
              <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">${this.escapeHtml(message)}</p>
              ${workflowSection}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;color:#94a3b8;font-size:12px;">Este es un mensaje automático. Por favor no responda este correo.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

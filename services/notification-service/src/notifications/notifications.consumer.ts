import {
  Injectable,
  Inject,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { AppLogger, KAFKA_CLIENT, KafkaProducerService, TOPICS, runWithCorrelation, withDlt } from '@sgd/common';
import { NotificationsService } from './notifications.service';
import { SseService } from './sse.service';
import { EmailService } from './email/email.service';
import { NotificationType, NOTIFICATION_TYPES } from './entities/notification.entity';

interface NotificationPayload {
  type: NotificationType;
  recipientUserIds: string[];
  orgId?: string | null;
  orgName?: string | null;
  workflowId?: string;
  workflowTitle?: string;
  message: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
}

interface UserInvitedPayload {
  userId: string;
  email: string;
  invitationToken: string;
  expiresAt: string;
}

interface PasswordResetPayload {
  email: string;
  resetToken: string;
  expiresAt: string;
}

function isValidPasswordResetPayload(raw: unknown): raw is PasswordResetPayload {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  return (
    typeof p['email']      === 'string' &&
    typeof p['resetToken'] === 'string' &&
    typeof p['expiresAt']  === 'string'
  );
}

// Shared by user.org-removed, user.org-deactivated and user.permissions-changed —
// all three carry just { userId, orgId } and are relayed to the browser as an SSE event.
interface UserOrgEventPayload {
  userId: string;
  orgId: string;
}

function isValidUserOrgEventPayload(raw: unknown): raw is UserOrgEventPayload {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  return typeof p['userId'] === 'string' && typeof p['orgId'] === 'string';
}

interface UserSuperAdminRevokedPayload {
  userId: string;
}

function isValidUserSuperAdminRevokedPayload(raw: unknown): raw is UserSuperAdminRevokedPayload {
  if (!raw || typeof raw !== 'object') return false;
  return typeof (raw as Record<string, unknown>)['userId'] === 'string';
}

interface UserDisabledPayload {
  userId: string;
}

function isValidUserDisabledPayload(raw: unknown): raw is UserDisabledPayload {
  if (!raw || typeof raw !== 'object') return false;
  return typeof (raw as Record<string, unknown>)['userId'] === 'string';
}

function isValidNotificationPayload(raw: unknown): raw is NotificationPayload {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  const type         = p['type'];
  const orgId        = p['orgId'];
  const orgName      = p['orgName'];
  const workflowId   = p['workflowId'];
  const workflowTitle = p['workflowTitle'];
  const timestamp    = p['timestamp'];
  const metadata     = p['metadata'];
  return (
    typeof type === 'string' &&
    (NOTIFICATION_TYPES as readonly unknown[]).includes(type) &&
    Array.isArray(p['recipientUserIds']) &&
    (p['recipientUserIds'] as unknown[]).every((id) => typeof id === 'string') &&
    typeof p['message'] === 'string' &&
    (orgId        === undefined || orgId        === null || typeof orgId        === 'string') &&
    (orgName      === undefined || orgName      === null || typeof orgName      === 'string') &&
    (workflowId   === undefined || typeof workflowId   === 'string') &&
    (workflowTitle === undefined || typeof workflowTitle === 'string') &&
    (timestamp    === undefined || typeof timestamp    === 'string') &&
    (metadata === undefined || (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)))
  );
}

function isValidUserInvitedPayload(raw: unknown): raw is UserInvitedPayload {
  if (!raw || typeof raw !== 'object') return false;
  const p = raw as Record<string, unknown>;
  return (
    typeof p['userId'] === 'string' &&
    typeof p['email'] === 'string' &&
    typeof p['invitationToken'] === 'string' &&
    typeof p['expiresAt'] === 'string'
  );
}

@Injectable()
export class NotificationsConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private consumer!: Consumer;

  constructor(
    @Inject(KAFKA_CLIENT) private readonly kafka: Kafka,
    private readonly config: ConfigService,
    private readonly notificationsService: NotificationsService,
    private readonly sseService: SseService,
    private readonly emailService: EmailService,
    private readonly logger: AppLogger,
    private readonly producer: KafkaProducerService,
  ) {}

  async onApplicationBootstrap() {
    const groupId = this.config.getOrThrow<string>('KAFKA_CONSUMER_GROUP');
    this.consumer = this.kafka.consumer({
      groupId,
      // Connection-level retry: reconnects up to 3 times on broker unavailability.
      // Message-level retry is handled by withDlt inside eachMessage.
      retry: { initialRetryTime: 300, retries: 3 },
    });

    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [TOPICS.NOTIFICATION_SEND, TOPICS.USER_INVITED, TOPICS.USER_ORG_REMOVED, TOPICS.USER_ORG_DEACTIVATED, TOPICS.USER_PERMISSIONS_CHANGED, TOPICS.USER_SUPER_ADMIN_REVOKED, TOPICS.USER_DISABLED, TOPICS.PASSWORD_RESET],
      fromBeginning: false,
    });

    await this.consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        await runWithCorrelation(payload.message, () =>
          withDlt(
            {
              topic: payload.topic,
              message: payload.message,
              producer: this.producer,
              logger: this.logger,
              context: 'NotificationsConsumer',
            },
            () => this.handleMessage(payload),
          ),
        );
      },
    });

    this.logger.log(
      `Kafka consumer connected — listening on [${TOPICS.NOTIFICATION_SEND}, ${TOPICS.USER_INVITED}, ${TOPICS.USER_ORG_REMOVED}, ${TOPICS.USER_ORG_DEACTIVATED}, ${TOPICS.USER_PERMISSIONS_CHANGED}, ${TOPICS.USER_SUPER_ADMIN_REVOKED}, ${TOPICS.USER_DISABLED}, ${TOPICS.PASSWORD_RESET}]`,
      'NotificationsConsumer',
    );
  }

  async onApplicationShutdown() {
    await this.consumer?.disconnect();
    this.logger.log('Kafka consumer disconnected', 'NotificationsConsumer');
  }

  /**
   * Validates a { userId, orgId } payload, pushes it as an SSE event, and logs
   * the outcome — shared by user.org-removed, user.org-deactivated and
   * user.permissions-changed, which only differ in the topic name, the SSE
   * event name delivered to the browser, and the log verb.
   */
  private handleOrgSessionSignal(
    raw: unknown,
    topic: string,
    eventName: 'session-revoked' | 'permissions-changed',
    logVerb: string,
  ): void {
    if (!isValidUserOrgEventPayload(raw)) {
      this.logger.warn(`[kafka] Invalid ${topic} payload — skipping`, 'NotificationsConsumer');
      return;
    }
    this.sseService.emit(raw.userId, { orgId: raw.orgId }, eventName);
    this.logger.log(
      `${logVerb} SSE sent to user ${raw.userId} for org ${raw.orgId}`,
      'NotificationsConsumer',
    );
  }

  private async handleMessage({ topic, message }: EachMessagePayload) {
    if (!message.value) return;

    let raw: unknown;
    try {
      raw = JSON.parse(message.value.toString());
    } catch {
      this.logger.warn(
        `[kafka] Malformed JSON in topic ${topic} — skipping`,
        'NotificationsConsumer',
      );
      return;
    }

    this.logger.http({ type: 'kafka-consume', topic, message: `← [kafka] ${topic}` });

    if (topic === TOPICS.PASSWORD_RESET) {
      if (!isValidPasswordResetPayload(raw)) {
        this.logger.warn(
          `[kafka] Invalid auth.password-reset payload — skipping`,
          'NotificationsConsumer',
        );
        return;
      }
      await this.emailService.sendPasswordReset({
        to:         raw.email,
        resetToken: raw.resetToken,
        expiresAt:  raw.expiresAt,
      });
      return;
    }

    if (topic === TOPICS.USER_INVITED) {
      if (!isValidUserInvitedPayload(raw)) {
        this.logger.warn(
          `[kafka] Invalid user.invited payload — skipping`,
          'NotificationsConsumer',
        );
        return;
      }
      await this.emailService.sendInvitation({
        to:              raw.email,
        invitationToken: raw.invitationToken,
        expiresAt:       raw.expiresAt,
      });
      return;
    }

    if (topic === TOPICS.USER_ORG_REMOVED) {
      // Push SSE event to revoke the user's active browser session immediately.
      // The frontend listens for 'session-revoked' and clears the auth state.
      this.handleOrgSessionSignal(raw, 'user.org-removed', 'session-revoked', 'Session revocation');
      return;
    }

    if (topic === TOPICS.USER_ORG_DEACTIVATED) {
      // Same session-revoked SSE as user.org-removed — the frontend reacts by
      // exiting/switching away from that company context regardless of whether
      // the user lost membership or the company was deactivated.
      this.handleOrgSessionSignal(raw, 'user.org-deactivated', 'session-revoked', 'Session revocation');
      return;
    }

    if (topic === TOPICS.USER_PERMISSIONS_CHANGED) {
      // Tells the frontend to silently mint a fresh access token (so the JWT's
      // baked-in permissions claim is current) and refetch permission-gated
      // data — unlike session-revoked, the user's session stays open.
      this.handleOrgSessionSignal(raw, 'user.permissions-changed', 'permissions-changed', 'Permissions-changed');
      return;
    }

    if (topic === TOPICS.USER_SUPER_ADMIN_REVOKED) {
      if (!isValidUserSuperAdminRevokedPayload(raw)) {
        this.logger.warn(
          `[kafka] Invalid user.super-admin-revoked payload — skipping`,
          'NotificationsConsumer',
        );
        return;
      }
      this.sseService.emit(raw.userId, {}, 'super-admin-revoked');
      this.logger.log(
        `Super admin revocation SSE sent to user ${raw.userId}`,
        'NotificationsConsumer',
      );
      return;
    }

    if (topic === TOPICS.USER_DISABLED) {
      if (!isValidUserDisabledPayload(raw)) {
        this.logger.warn(
          `[kafka] Invalid user.disabled payload — skipping`,
          'NotificationsConsumer',
        );
        return;
      }
      // Push SSE event to log the user out of any open tab immediately —
      // disableCredentials()/revokeAllTokens() alone don't invalidate an
      // already-issued, not-yet-expired access token sitting in the browser.
      this.sseService.emit(raw.userId, {}, 'account-disabled');
      this.logger.log(
        `Account-disabled SSE sent to user ${raw.userId}`,
        'NotificationsConsumer',
      );
      return;
    }

    if (!isValidNotificationPayload(raw)) {
      this.logger.warn(
        `[kafka] Invalid payload in ${topic} — skipping`,
        'NotificationsConsumer',
      );
      return;
    }

    await this.notificationsService.dispatch({
      type:             raw.type,
      recipientUserIds: raw.recipientUserIds,
      message:          raw.message,
      orgId:            raw.orgId ?? null,
      orgName:          raw.orgName ?? null,
      workflowId:       raw.workflowId ?? null,
      workflowTitle:    raw.workflowTitle ?? null,
      metadata:         raw.metadata,
    });
  }
}

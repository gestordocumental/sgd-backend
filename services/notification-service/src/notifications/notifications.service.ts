import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification, NotificationType } from './entities/notification.entity';
import { NotificationResponseDto, PaginatedNotificationsDto } from './dto/notification-response.dto';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { EmailService, getNotificationTitle } from './email/email.service';
import { UserClientService } from './user-client/user-client.service';
import { AppLogger } from '../common/logger/app-logger.service';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly repo: Repository<Notification>,
    private readonly emailService: EmailService,
    private readonly userClient: UserClientService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Crea notificaciones internas y envía emails para todos los destinatarios.
   */
  async dispatch(opts: {
    type: NotificationType;
    recipientUserIds: string[];
    message: string;
    workflowId?: string | null;
    workflowTitle?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    const { type, recipientUserIds, message, workflowId, workflowTitle, metadata } = opts;
    const title = getNotificationTitle(type);

    // Guardar notificaciones internas en bulk
    const entities = recipientUserIds.map((userId) => {
      const n = this.repo.create({
        userId,
        type,
        title,
        message,
        workflowId:    workflowId ?? null,
        workflowTitle: workflowTitle ?? null,
        metadata:      metadata ?? null,
        read:          false,
        readAt:        null,
      });
      return n;
    });

    await this.repo.save(entities);
    this.logger.log(
      `Stored ${entities.length} internal notification(s) [${type}]`,
      'NotificationsService',
    );

    // Enviar emails — obtener datos de usuario de forma paralela
    const userMap = await this.userClient.getUsersByIds(recipientUserIds);

    await Promise.all(
      recipientUserIds.map(async (userId) => {
        const user = userMap.get(userId);
        if (!user?.email) {
          this.logger.warn(`No email found for user ${userId} — skipping email`, 'NotificationsService');
          return;
        }
        await this.emailService.sendNotification({
          to:            user.email,
          type,
          message,
          workflowTitle,
          workflowId,
        });
      }),
    );
  }

  async list(userId: string, dto: ListNotificationsDto): Promise<PaginatedNotificationsDto> {
    const { page, limit, unreadOnly } = dto;

    const qb = this.repo
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId })
      .orderBy('n.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (unreadOnly) {
      qb.andWhere('n.read = false');
    }

    const [items, total] = await qb.getManyAndCount();

    const unreadCount = await this.repo.count({
      where: { userId, read: false },
    });

    const result = new PaginatedNotificationsDto();
    result.data        = items.map(NotificationResponseDto.from);
    result.total       = total;
    result.page        = page;
    result.limit       = limit;
    result.unreadCount = unreadCount;
    return result;
  }

  async markAsRead(id: string, userId: string): Promise<NotificationResponseDto> {
    const notification = await this.repo.findOne({ where: { id, userId } });
    if (!notification) {
      throw new NotFoundException(`Notification ${id} not found`);
    }
    if (!notification.read) {
      notification.read   = true;
      notification.readAt = new Date();
      await this.repo.save(notification);
    }
    return NotificationResponseDto.from(notification);
  }

  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const result = await this.repo
      .createQueryBuilder()
      .update(Notification)
      .set({ read: true, readAt: new Date() })
      .where('user_id = :userId AND read = false', { userId })
      .execute();

    return { updated: result.affected ?? 0 };
  }

  async getUnreadCount(userId: string): Promise<{ count: number }> {
    const count = await this.repo.count({ where: { userId, read: false } });
    return { count };
  }
}

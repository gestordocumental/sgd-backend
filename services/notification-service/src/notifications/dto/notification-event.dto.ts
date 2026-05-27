import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { NotificationType, NOTIFICATION_TYPES } from '../entities/notification.entity';

/**
 * Payload que llega desde Kafka en el tópico notification.send.
 * Publicado principalmente por workflow-service.
 */
export class NotificationEventDto {
  @IsIn(NOTIFICATION_TYPES)
  type!: NotificationType;

  @IsArray()
  @IsUUID('4', { each: true })
  recipientUserIds!: string[];

  @IsOptional()
  @IsUUID('4')
  orgId?: string;

  @IsOptional()
  @IsString()
  orgName?: string;

  @IsOptional()
  @IsUUID('4')
  workflowId?: string;

  @IsOptional()
  @IsString()
  workflowTitle?: string;

  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsOptional()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  timestamp?: string;
}

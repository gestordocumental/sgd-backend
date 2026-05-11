import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { NotificationType } from '../entities/notification.entity';

/**
 * Payload que llega desde Kafka en el tópico notification.send.
 * Publicado principalmente por workflow-service.
 */
export class NotificationEventDto {
  @IsString()
  @IsNotEmpty()
  type!: NotificationType;

  @IsArray()
  @IsUUID('4', { each: true })
  recipientUserIds!: string[];

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

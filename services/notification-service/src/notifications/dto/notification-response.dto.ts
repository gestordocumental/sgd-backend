import { ApiProperty } from '@nestjs/swagger';
import { Notification } from '../entities/notification.entity';

export class NotificationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  message!: string;

  @ApiProperty({ nullable: true })
  workflowId!: string | null;

  @ApiProperty({ nullable: true })
  workflowTitle!: string | null;

  @ApiProperty()
  read!: boolean;

  @ApiProperty({ nullable: true })
  readAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  static from(n: Notification): NotificationResponseDto {
    const dto = new NotificationResponseDto();
    dto.id            = n.id;
    dto.type          = n.type;
    dto.title         = n.title;
    dto.message       = n.message;
    dto.workflowId    = n.workflowId;
    dto.workflowTitle = n.workflowTitle;
    dto.read          = n.read;
    dto.readAt        = n.readAt;
    dto.createdAt     = n.createdAt;
    return dto;
  }
}

export class PaginatedNotificationsDto {
  @ApiProperty({ type: [NotificationResponseDto] })
  items!: NotificationResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  unreadCount!: number;
}

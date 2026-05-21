import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationResponseDto, PaginatedNotificationsDto } from './dto/notification-response.dto';
import { Auth } from '../common/decorators/auth.decorator';
import { JwtPayloadParam, JwtPayload } from '../common/decorators/jwt-payload.decorator';

@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@Controller('api/notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @ApiOperation({ summary: 'Listar notificaciones del usuario autenticado' })
  @ApiOkResponse({ type: PaginatedNotificationsDto })
  @Auth()
  @Get()
  list(
    @JwtPayloadParam() user: JwtPayload,
    @Query() dto: ListNotificationsDto,
  ): Promise<PaginatedNotificationsDto> {
    return this.service.list(user.sub, dto);
  }

  @ApiOperation({ summary: 'Cantidad de notificaciones no leídas' })
  @ApiOkResponse({ schema: { example: { count: 5 } } })
  @Auth()
  @Get('unread-count')
  unreadCount(
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<{ count: number }> {
    return this.service.getUnreadCount(user.sub);
  }

  @ApiOperation({ summary: 'Marcar todas las notificaciones como leídas' })
  @ApiOkResponse({ schema: { example: { updated: 3 } } })
  @Auth()
  @Patch('read-all')
  markAllAsRead(
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<{ updated: number }> {
    return this.service.markAllAsRead(user.sub);
  }

  @ApiOperation({ summary: 'Marcar una notificación como leída' })
  @ApiOkResponse({ type: NotificationResponseDto })
  @ApiNotFoundResponse({ description: 'Notification not found' })
  @Auth()
  @Patch(':id/read')
  markAsRead(
    @Param('id', ParseUUIDPipe) id: string,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<NotificationResponseDto> {
    return this.service.markAsRead(id, user.sub);
  }
}

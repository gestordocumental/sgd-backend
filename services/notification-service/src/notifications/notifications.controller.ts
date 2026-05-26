import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  ParseUUIDPipe,
  Req,
  Sse,
  MessageEvent,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { IncomingMessage } from 'http';
import { NotificationsService } from './notifications.service';
import { SseService } from './sse.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationResponseDto, PaginatedNotificationsDto } from './dto/notification-response.dto';
import { Auth, JwtPayloadParam, JwtPayload } from '@sgd/common';

@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly sseService: SseService,
  ) {}

  @ApiOperation({ summary: 'Stream SSE de notificaciones en tiempo real' })
  @Auth()
  @Sse('stream')
  stream(
    @JwtPayloadParam() user: JwtPayload,
    @Req() req: IncomingMessage,
  ): Observable<MessageEvent> {
    return this.sseService.connect(user.sub, req);
  }

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

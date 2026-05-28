import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  ParseUUIDPipe,
  Req,
  Sse,
  MessageEvent,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { IncomingMessage } from 'http';
import { NotificationsService } from './notifications.service';
import { SseService } from './sse.service';
import { SseTicketService } from './sse-ticket.service';
import { ListNotificationsDto } from './dto/list-notifications.dto';
import { NotificationResponseDto, PaginatedNotificationsDto } from './dto/notification-response.dto';
import type { Request } from 'express';
import { SseTicketGuard } from './sse-ticket.guard';
import { Auth, JwtPayloadParam, JwtPayload } from '@sgd/common';

@ApiTags('Notifications')
@ApiBearerAuth('JWT')
@Controller('api/v1/notifications')
export class NotificationsController {
  constructor(
    private readonly service: NotificationsService,
    private readonly sseService: SseService,
    private readonly sseTicketService: SseTicketService,
  ) {}

  /**
   * Issues a short-lived (30s) ticket stored in Redis.
   * The client opens an SSE connection via GET /stream?ticket=<uuid>.
   * Keeping the full JWT out of the URL prevents it from appearing in server/proxy access logs.
   */
  @ApiOperation({ summary: 'Obtener ticket efímero para conectar al stream SSE' })
  @ApiOkResponse({ schema: { example: { ticket: 'uuid', expiresIn: 30 } } })
  @Auth()
  @Post('stream/ticket')
  async issueTicket(@JwtPayloadParam() user: JwtPayload): Promise<{ ticket: string; expiresIn: number }> {
    const ticket = await this.sseTicketService.create(user.sub);
    return { ticket, expiresIn: 30 };
  }

  /**
   * SSE stream — ticket validated by SseTicketGuard BEFORE NestJS sets SSE headers.
   * This is critical: once @Sse() flushes the 200 OK headers, a 401 can no longer
   * be sent. The guard validates against Redis and writes userId onto the request,
   * so this handler stays fully synchronous.
   */
  @ApiOperation({ summary: 'Stream SSE de notificaciones en tiempo real' })
  @ApiQuery({ name: 'ticket', description: 'Ticket efímero obtenido de POST /stream/ticket' })
  @UseGuards(SseTicketGuard)
  @Sse('stream')
  stream(@Req() req: Request & { sseUserId: string }): Observable<MessageEvent> {
    return this.sseService.connect(req.sseUserId, req as unknown as IncomingMessage);
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

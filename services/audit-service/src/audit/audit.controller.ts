import {
  Controller,
  Get,
  Param,
  Query,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Auth } from '../common/decorators/auth.decorator';
import { JwtPayloadParam, JwtPayload } from '../common/decorators/jwt-payload.decorator';
import { AuditService } from './audit.service';
import { AuditQueryDto, AuditExportDto } from './dto/audit-query.dto';

@ApiTags('Audit')
@ApiBearerAuth('JWT')
@Controller('api/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Consulta paginada del registro de auditoría.
   *
   * - Super admin: puede filtrar por cualquier orgId (o ver todos si no filtra).
   * - Usuario normal: solo puede ver eventos de su propia organización (orgId = companyId del token).
   */
  @Auth()
  @Get('logs')
  @ApiOperation({ summary: 'Consultar registro de auditoría (paginado)' })
  @ApiOkResponse({ description: 'Lista paginada de eventos de auditoría' })
  async getLogs(
    @Query() dto: AuditQueryDto,
    @JwtPayloadParam() me: JwtPayload,
  ) {
    if (!me.isSuperAdmin) {
      // Usuarios normales solo pueden ver su propia organización
      if (!me.companyId) {
        throw new ForbiddenException('No organization context found in token');
      }
      // Si el usuario pasa un orgId distinto al suyo, rechazar
      if (dto.orgId && dto.orgId !== me.companyId) {
        throw new ForbiddenException('Access to this organization is not allowed');
      }
      dto.orgId = me.companyId;
    }

    return this.auditService.query(dto);
  }

  @Auth()
  @Get('logs/export')
  @ApiOperation({ summary: 'Exportar eventos de auditoría (máx. 5000 registros)' })
  @ApiOkResponse({ description: 'Lista plana de eventos para exportar a Excel' })
  async exportLogs(
    @Query() dto: AuditExportDto,
    @JwtPayloadParam() me: JwtPayload,
  ) {
    if (!me.isSuperAdmin) {
      if (!me.companyId) throw new ForbiddenException('No organization context found in token');
      if (dto.orgId && dto.orgId !== me.companyId) throw new ForbiddenException('Access to this organization is not allowed');
      dto.orgId = me.companyId;
    }
    return this.auditService.export(dto);
  }

  /**
   * Obtiene un evento de auditoría por su ID de Elasticsearch.
   * Super admins pueden ver cualquier evento; usuarios normales solo de su org.
   */
  @Auth()
  @Get('logs/:id')
  @ApiOperation({ summary: 'Obtener un evento de auditoría por ID' })
  @ApiOkResponse({ description: 'Evento de auditoría' })
  @ApiNotFoundResponse({ description: 'Evento no encontrado' })
  async getById(
    @Param('id') id: string,
    @JwtPayloadParam() me: JwtPayload,
  ) {
    const doc = await this.auditService.findById(id);
    if (!doc) throw new NotFoundException('Audit log not found');

    if (!me.isSuperAdmin && doc.orgId !== me.companyId) {
      throw new ForbiddenException('Access to this organization is not allowed');
    }

    return doc;
  }
}

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
import { Auth, JwtPayloadParam, JwtPayload } from '@sgd/common';
import { AuditService } from './audit.service';
import { AuditQueryDto, AuditExportDto } from './dto/audit-query.dto';

@ApiTags('Audit')
@ApiBearerAuth('JWT')
@Controller('api/v1/audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Consulta paginada del registro de auditoría.
   *
   * - Super admin: ve eventos de plataforma (orgId = null) — gestión de empresas/usuarios a nivel global.
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
    if (me.isSuperAdmin) {
      // Super admin: ve eventos de plataforma (orgId = null).
      // Acciones sobre empresas/usuarios como plataforma, no eventos de negocio de cada empresa.
      dto.orgId = undefined;
      return this.auditService.query(dto, true);
    }

    // Usuarios de org: solo su organización, nunca eventos de super admin.
    if (!me.companyId) {
      throw new ForbiddenException('No organization context found in token');
    }
    if (dto.orgId && dto.orgId !== me.companyId) {
      throw new ForbiddenException('Access to this organization is not allowed');
    }
    dto.orgId = me.companyId;
    return this.auditService.query(dto, false);
  }

  @Auth()
  @Get('logs/export')
  @ApiOperation({ summary: 'Exportar eventos de auditoría (máx. 5000 registros)' })
  @ApiOkResponse({ description: 'Lista plana de eventos para exportar a Excel' })
  async exportLogs(
    @Query() dto: AuditExportDto,
    @JwtPayloadParam() me: JwtPayload,
  ) {
    if (me.isSuperAdmin) {
      dto.orgId = undefined;
      return this.auditService.export(dto, true);
    }

    if (!me.companyId) throw new ForbiddenException('No organization context found in token');
    if (dto.orgId && dto.orgId !== me.companyId) throw new ForbiddenException('Access to this organization is not allowed');
    dto.orgId = me.companyId;
    return this.auditService.export(dto, false);
  }

  /**
   * Obtiene un evento de auditoría por su ID de Elasticsearch.
   * Super admin: puede acceder a cualquier evento. Org user: solo eventos de su org.
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

    if (me.isSuperAdmin) {
      // Super admin solo puede acceder a eventos de plataforma (sin orgId)
      if (doc.orgId) throw new ForbiddenException('Access to this event is not allowed');
    } else {
      if (!me.companyId) throw new ForbiddenException('No organization context found in token');
      // Org user solo puede acceder a eventos de su org
      if (doc.orgId !== me.companyId) throw new ForbiddenException('Access to this organization is not allowed');
    }

    return doc;
  }
}

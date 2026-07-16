import { Controller, Get, Query, BadRequestException, UseGuards } from '@nestjs/common';
import { InternalGuard, AllowInternalTokens } from '@sgd/common';
import { AuditService } from './audit.service';
import { AuditExportDto } from './dto/audit-query.dto';

/**
 * Service-to-service access to a single correlation ID's audit trail,
 * bypassing the user-facing AUDIT:READ permission entirely. Used by
 * workflow-service so any user who can already view a workflow (its own
 * access check, unrelated to AUDIT:READ) can also pull that workflow's
 * audit history when downloading its attachments — see
 * workflow-timeline.service.ts, which sets correlationId = workflow.id for
 * every event tied to that workflow.
 */
@Controller('internal/audit')
@UseGuards(InternalGuard)
@AllowInternalTokens('INTERNAL_TOKEN_WORKFLOW_AUDIT')
export class InternalAuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('logs-by-correlation')
  async getLogsByCorrelation(@Query() dto: AuditExportDto) {
    if (!dto.correlationId) throw new BadRequestException('correlationId query param is required');
    if (!dto.orgId) throw new BadRequestException('orgId query param is required');
    return this.auditService.export(dto, false);
  }
}

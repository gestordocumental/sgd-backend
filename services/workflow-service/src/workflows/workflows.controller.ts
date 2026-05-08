import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';

import { WorkflowsService } from './workflows.service';
import { WorkflowApprovalService } from './workflow-approval.service';
import { WorkflowAdminCycleService } from './workflow-admin-cycle.service';

import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { NotifyNoFinalUsersDto } from './dto/notify-no-final-users.dto';
import { ApproveWorkflowDto } from './dto/approve-workflow.dto';
import { RejectWorkflowDto } from './dto/reject-workflow.dto';
import { ResubmitWorkflowDto } from './dto/resubmit-workflow.dto';
import { CreateAdminCycleDto } from './dto/create-admin-cycle.dto';
import { CompleteAdminStepDto } from './dto/complete-admin-step.dto';
import { CloseWorkflowDto } from './dto/close-workflow.dto';
import { ListWorkflowsDto } from './dto/list-workflows.dto';
import {
  WorkflowResponseDto,
  PaginatedWorkflowsDto,
  TimelineEventResponseDto,
  AdminCycleResponseDto,
} from './dto/workflow-response.dto';

import { OrgMember } from '../common/decorators/auth.decorator';
import { JwtPayloadParam, JwtPayload } from '../common/decorators/jwt-payload.decorator';

/**
 * IMPORTANTE — Orden de rutas:
 * Las rutas con path literal (/my-tasks, /my-available) DEBEN registrarse
 * ANTES de las rutas con parámetros (/:id) para evitar conflictos de matching en NestJS.
 */
@ApiTags('Workflows')
@ApiBearerAuth('JWT')
@Controller('api/workflows')
export class WorkflowsController {
  constructor(
    private readonly workflowsService: WorkflowsService,
    private readonly approvalService: WorkflowApprovalService,
    private readonly adminCycleService: WorkflowAdminCycleService,
  ) {}

  // ── Rutas estáticas PRIMERO ───────────────────────────────────────────────────

  @Get('my-tasks')
  @OrgMember()
  @ApiOperation({ summary: 'Tareas pendientes del usuario autenticado (aprobador o paso admin)' })
  @ApiResponse({ status: 200, type: [WorkflowResponseDto] })
  getMyTasks(@JwtPayloadParam() user: JwtPayload): Promise<WorkflowResponseDto[]> {
    return this.workflowsService.getMyTasks(user);
  }

  @Get('my-available')
  @OrgMember()
  @ApiOperation({ summary: 'Workflows disponibles para el usuario como usuario final' })
  @ApiResponse({ status: 200, type: [WorkflowResponseDto] })
  getMyAvailable(@JwtPayloadParam() user: JwtPayload): Promise<WorkflowResponseDto[]> {
    return this.workflowsService.getMyAvailable(user);
  }

  @Post('notify-no-final-users')
  @OrgMember()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Notifica a los administradores que una tipología no tiene usuarios finales elegibles' })
  @ApiResponse({ status: 204 })
  notifyNoFinalUsers(
    @Body() dto: NotifyNoFinalUsersDto,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<void> {
    return this.workflowsService.notifyNoFinalUsers(dto, user);
  }

  // ── CRUD general ──────────────────────────────────────────────────────────────

  @Post()
  @OrgMember()
  @ApiOperation({ summary: 'Crear un nuevo workflow en estado DRAFT' })
  @ApiResponse({ status: 201, type: WorkflowResponseDto })
  create(
    @Body() dto: CreateWorkflowDto,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<WorkflowResponseDto> {
    return this.workflowsService.create(dto, user);
  }

  @Get()
  @OrgMember()
  @ApiOperation({ summary: 'Listar workflows de la organización (con filtros y paginación)' })
  @ApiResponse({ status: 200, type: PaginatedWorkflowsDto })
  findAll(
    @Query() dto: ListWorkflowsDto,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<PaginatedWorkflowsDto> {
    return this.workflowsService.findAll(dto, user);
  }

  @Get(':id')
  @OrgMember()
  @ApiOperation({ summary: 'Detalle de un workflow' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkflowResponseDto })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<WorkflowResponseDto> {
    return this.workflowsService.findOne(id, user);
  }

  @Patch(':id')
  @OrgMember()
  @ApiOperation({ summary: 'Actualizar workflow (solo en estado DRAFT)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkflowResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkflowDto,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<WorkflowResponseDto> {
    return this.workflowsService.update(id, dto, user);
  }

  @Delete(':id')
  @OrgMember()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar workflow (soft delete, solo DRAFT o CANCELLED)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204 })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<void> {
    return this.workflowsService.remove(id, user);
  }

  // ── Ciclo de aprobación ───────────────────────────────────────────────────────

  @Post(':id/start-approval')
  @OrgMember()
  @ApiOperation({ summary: 'Iniciar ciclo de aprobación (creador → PENDING_APPROVAL)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkflowResponseDto })
  async startApproval(
    @Param('id', ParseUUIDPipe) id: string,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<WorkflowResponseDto> {
    await this.approvalService.startApproval(id, user.sub!);
    return this.workflowsService.findOne(id, user);
  }

  @Post(':id/approve')
  @OrgMember()
  @ApiOperation({ summary: 'Aprobar el paso actual (aprobador actual)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkflowResponseDto })
  async approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApproveWorkflowDto,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<WorkflowResponseDto> {
    await this.approvalService.approve(id, user.sub!, dto);
    return this.workflowsService.findOne(id, user);
  }

  @Post(':id/reject')
  @OrgMember()
  @ApiOperation({ summary: 'Rechazar con observaciones obligatorias (aprobador actual)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkflowResponseDto })
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectWorkflowDto,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<WorkflowResponseDto> {
    await this.approvalService.reject(id, user.sub!, dto);
    return this.workflowsService.findOne(id, user);
  }

  @Post(':id/resubmit')
  @OrgMember()
  @ApiOperation({ summary: 'Reenviar al aprobador tras corregir (creador)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkflowResponseDto })
  async resubmit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResubmitWorkflowDto,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<WorkflowResponseDto> {
    await this.approvalService.resubmit(id, user.sub!, dto);
    return this.workflowsService.findOne(id, user);
  }

  // ── Ciclos administrativos ────────────────────────────────────────────────────

  @Post(':id/admin-cycles')
  @OrgMember()
  @ApiOperation({ summary: 'Iniciar ciclo administrativo (usuario final)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, type: AdminCycleResponseDto })
  @HttpCode(HttpStatus.CREATED)
  async createAdminCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateAdminCycleDto,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<AdminCycleResponseDto> {
    const cycle = await this.adminCycleService.createCycle(id, user.sub!, dto);
    return AdminCycleResponseDto.from(cycle);
  }

  @Patch(':id/admin-cycles/:cycleId/steps/:stepId/complete')
  @OrgMember()
  @ApiOperation({ summary: 'Completar paso administrativo (usuario admin asignado)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'cycleId', format: 'uuid' })
  @ApiParam({ name: 'stepId', format: 'uuid' })
  @ApiResponse({ status: 200 })
  completeAdminStep(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @Param('stepId', ParseUUIDPipe) stepId: string,
    @Body() dto: CompleteAdminStepDto,
    @JwtPayloadParam() user: JwtPayload,
  ) {
    return this.adminCycleService.completeStep(id, cycleId, stepId, user.sub!, dto);
  }

  @Post(':id/admin-cycles/:cycleId/finalize')
  @OrgMember()
  @ApiOperation({ summary: 'Confirmar finalización del ciclo administrativo (usuario final iniciador)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'cycleId', format: 'uuid' })
  @ApiResponse({ status: 200, type: AdminCycleResponseDto })
  async finalizeAdminCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<AdminCycleResponseDto> {
    const cycle = await this.adminCycleService.finalizeCycle(id, cycleId, user.sub!);
    return AdminCycleResponseDto.from(cycle);
  }

  // ── Omitir ciclo de revisión ──────────────────────────────────────────────────

  @Post(':id/skip-review-cycle')
  @OrgMember()
  @ApiOperation({ summary: 'Omitir ciclo de revisión y pasar directamente a AVAILABLE (usuario final)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkflowResponseDto })
  async skipReviewCycle(
    @Param('id', ParseUUIDPipe) id: string,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<WorkflowResponseDto> {
    await this.adminCycleService.skipReviewCycle(id, user.sub!);
    return this.workflowsService.findOne(id, user);
  }

  // ── Cierre ────────────────────────────────────────────────────────────────────

  @Post(':id/close')
  @OrgMember()
  @ApiOperation({ summary: 'Cerrar definitivamente el workflow (usuario final)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: WorkflowResponseDto })
  async close(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseWorkflowDto,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<WorkflowResponseDto> {
    await this.adminCycleService.closeWorkflow(id, user.sub!, dto);
    return this.workflowsService.findOne(id, user);
  }

  // ── Trazabilidad ──────────────────────────────────────────────────────────────

  @Get(':id/timeline')
  @OrgMember()
  @ApiOperation({ summary: 'Línea de tiempo completa del workflow' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: [TimelineEventResponseDto] })
  getTimeline(
    @Param('id', ParseUUIDPipe) id: string,
    @JwtPayloadParam() user: JwtPayload,
  ): Promise<TimelineEventResponseDto[]> {
    return this.workflowsService.getTimeline(id, user);
  }
}

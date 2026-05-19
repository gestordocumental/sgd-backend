import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Workflow } from './entities/workflow.entity';
import { WorkflowApprovalStep } from './entities/workflow-approval-step.entity';
import { WorkflowApprovalAction } from './entities/workflow-approval-action.entity';
import { WorkflowAttachment } from './entities/workflow-attachment.entity';
import { WorkflowTimeline } from './entities/workflow-timeline.entity';
import { WorkflowAdminCycle } from './entities/workflow-admin-cycle.entity';
import {
  WorkflowStatus,
  ApprovalStepStatus,
  AttachmentType,
  TimelineEventType,
} from './entities/enums';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { ListWorkflowsDto } from './dto/list-workflows.dto';
import { NotifyNoFinalUsersDto } from './dto/notify-no-final-users.dto';
import {
  WorkflowResponseDto,
  PaginatedWorkflowsDto,
  TimelineEventResponseDto,
} from './dto/workflow-response.dto';
import { WorkflowTimelineService } from './workflow-timeline.service';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';
import { DocumentClientService } from '../common/clients/document-client.service';
import { TOPICS } from '../common/kafka/kafka.constants';
import { AppLogger } from '../common/logger/app-logger.service';
import { JwtPayload } from '../common/decorators/jwt-payload.decorator';

@Injectable()
export class WorkflowsService {
  constructor(
    @InjectRepository(Workflow)
    private readonly workflowRepo: Repository<Workflow>,
    @InjectRepository(WorkflowApprovalStep)
    private readonly stepRepo: Repository<WorkflowApprovalStep>,
    @InjectRepository(WorkflowApprovalAction)
    private readonly actionRepo: Repository<WorkflowApprovalAction>,
    @InjectRepository(WorkflowAttachment)
    private readonly attachmentRepo: Repository<WorkflowAttachment>,
    @InjectRepository(WorkflowTimeline)
    private readonly timelineRepo: Repository<WorkflowTimeline>,
    private readonly dataSource: DataSource,
    private readonly timelineService: WorkflowTimelineService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly documentClientService: DocumentClientService,
    private readonly logger: AppLogger,
  ) {}

  // ── Crear workflow ────────────────────────────────────────────────────────────

  async create(dto: CreateWorkflowDto, user: JwtPayload): Promise<WorkflowResponseDto> {
    const userId    = user.sub!;
    const orgId     = user.companyId!;

    this.validateApproverStepOrders(dto.approvers);

    // Obtener info de la tipología desde document-service
    const typologyInfo = await this.documentClientService.getTypologyInfo(orgId, dto.typologyId);

    // Documento principal: el frontend ya validó la coincidencia, sólo persistimos la referencia
    const mainDocumentValidated = !!dto.mainDocument;
    const mainDocumentMetadata: Record<string, unknown> | null = dto.mainDocument
      ? {
          storageKey:    dto.mainDocument.storageKey,
          originalName:  dto.mainDocument.originalName,
          mimeType:      dto.mainDocument.mimeType,
          fileSizeBytes: dto.mainDocument.fileSizeBytes ?? null,
        }
      : null;

    let savedWorkflow!: Workflow;

    await this.dataSource.transaction(async (manager) => {
      // Crear workflow
      const workflow = manager.create(Workflow, {
        orgId,
        title:                 dto.title,
        description:           dto.description ?? null,
        typologyId:            dto.typologyId,
        typologyCode:          typologyInfo.codigo,
        typologyVersion:       typologyInfo.version,
        typologyName:          typologyInfo.nombre,
        mainDocumentId:        dto.mainDocument?.storageKey ?? null,
        mainDocumentValidated,
        mainDocumentMetadata,
        status:                WorkflowStatus.DRAFT,
        createdBy:             userId,
        finalUserIds:          dto.finalUserIds,
      });
      savedWorkflow = await manager.save(Workflow, workflow);

      // Crear pasos de aprobación
      const sorted = [...dto.approvers].sort((a, b) => a.stepOrder - b.stepOrder);
      const steps  = sorted.map((a) =>
        manager.create(WorkflowApprovalStep, {
          workflowId: savedWorkflow.id,
          userId:     a.userId,
          stepOrder:  a.stepOrder,
          status:     ApprovalStepStatus.WAITING,
        }),
      );
      await manager.save(WorkflowApprovalStep, steps);

      // Registrar adjuntos de soporte
      if (dto.attachments?.length) {
        const attachments = dto.attachments.map((att) =>
          manager.create(WorkflowAttachment, {
            workflowId:     savedWorkflow.id,
            uploadedBy:     userId,
            documentId:     att.storageKey,
            storageKey:     att.storageKey,
            originalName:   att.originalName,
            mimeType:       att.mimeType,
            fileSizeBytes:  att.fileSizeBytes ?? null,
            attachmentType: AttachmentType.SUPPORTING,
          }),
        );
        await manager.save(WorkflowAttachment, attachments);
      }
    });

    await this.timelineService.record({
      workflowId:   savedWorkflow.id,
      orgId,
      eventType:    TimelineEventType.WORKFLOW_CREATED,
      actorId:      userId,
      resourceName: dto.title,
      description:  `Workflow "${dto.title}" creado en borrador con ${dto.approvers.length} aprobador(es).`,
      metadata: {
        typologyId:     dto.typologyId,
        typologyCode:   typologyInfo.codigo,
        approversCount: dto.approvers.length,
      },
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_CREATED, {
      workflowId:  savedWorkflow.id,
      orgId,
      title:       dto.title,
      typologyId:  dto.typologyId,
      createdBy:   userId,
      approverIds: dto.approvers.map((a) => a.userId),
      timestamp:   new Date().toISOString(),
    });

    return this.findOneOrFail(savedWorkflow.id, user);
  }

  // ── Listar workflows ──────────────────────────────────────────────────────────

  async findAll(dto: ListWorkflowsDto, user: JwtPayload): Promise<PaginatedWorkflowsDto> {
    const orgId = user.companyId!;
    const page  = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip  = (page - 1) * limit;

    const qb = this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.approvalSteps', 'steps')
      .where('w.org_id = :orgId', { orgId })
      .andWhere('w.deleted_at IS NULL');

    if (dto.status)    qb.andWhere('w.status = :status', { status: dto.status });
    if (dto.createdBy) qb.andWhere('w.created_by = :createdBy', { createdBy: dto.createdBy });

    qb.orderBy('w.createdAt', 'DESC').skip(skip).take(limit);

    const [workflows, total] = await qb.getManyAndCount();

    return {
      data:       workflows.map((w) => WorkflowResponseDto.from(w)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ── Detalle de workflow ───────────────────────────────────────────────────────

  async findOne(id: string, user: JwtPayload): Promise<WorkflowResponseDto> {
    return this.findOneOrFail(id, user);
  }

  // ── Tareas pendientes del usuario autenticado ─────────────────────────────────

  async getMyTasks(user: JwtPayload): Promise<WorkflowResponseDto[]> {
    const userId = user.sub!;
    const orgId  = user.companyId!;

    const workflows = await this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.approvalSteps', 'steps')
      .where('w.org_id = :orgId', { orgId })
      .andWhere('w.current_assigned_user_id = :userId', { userId })
      .andWhere('w.status IN (:...statuses)', {
        statuses: [WorkflowStatus.PENDING_APPROVAL, WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS, WorkflowStatus.PENDING_REVIEW_CYCLE],
      })
      .andWhere('w.deleted_at IS NULL')
      .orderBy('w.updatedAt', 'DESC')
      .getMany();

    return workflows.map((w) => WorkflowResponseDto.from(w));
  }

  // ── Workflows disponibles para usuario final ──────────────────────────────────

  async getMyAvailable(user: JwtPayload): Promise<WorkflowResponseDto[]> {
    const userId = user.sub!;
    const orgId  = user.companyId!;

    // El userId debe estar en el array finalUserIds (snapshot guardado al aprobar)
    const workflows = await this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.approvalSteps', 'steps')
      .where('w.org_id = :orgId', { orgId })
      .andWhere(':userId = ANY(w.final_user_ids)', { userId })
      .andWhere('w.status IN (:...statuses)', {
        statuses: [WorkflowStatus.AVAILABLE_FOR_FINAL_USERS, WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS],
      })
      .andWhere('w.deleted_at IS NULL')
      .orderBy('w.updatedAt', 'DESC')
      .getMany();

    return workflows.map((w) => WorkflowResponseDto.from(w));
  }

  // ── Actualizar workflow (solo en DRAFT) ───────────────────────────────────────

  async update(
    id: string,
    dto: UpdateWorkflowDto,
    user: JwtPayload,
  ): Promise<WorkflowResponseDto> {
    const userId   = user.sub!;
    const workflow = await this.workflowRepo.findOne({
      where: { id },
      relations: ['approvalSteps'],
    });
    if (!workflow) throw new NotFoundException('Workflow not found');

    // [RN-09] Solo DRAFT es modificable
    if (workflow.status !== WorkflowStatus.DRAFT) {
      throw new ConflictException('Only DRAFT workflows can be updated');
    }

    if (workflow.createdBy !== userId && !user.isSuperAdmin) {
      throw new ForbiddenException('Only the workflow creator can update it');
    }

    if (dto.approvers) {
      this.validateApproverStepOrders(dto.approvers);
    }

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    if (dto.title !== undefined && dto.title !== workflow.title)
      changes['title'] = { from: workflow.title, to: dto.title }
    if (dto.description !== undefined && dto.description !== workflow.description)
      changes['description'] = { from: workflow.description, to: dto.description ?? null }
    if (dto.approvers   !== undefined) changes['approvers']   = { from: null, to: null }
    if (dto.mainDocument !== undefined) changes['mainDocument'] = { from: null, to: null }
    if (dto.attachments !== undefined) changes['attachments'] = { from: null, to: null }

    await this.dataSource.transaction(async (manager) => {
      const updatePayload: Partial<Workflow> = {};

      if (dto.title !== undefined)       updatePayload.title       = dto.title;
      if (dto.description !== undefined) updatePayload.description = dto.description ?? null;

      if (dto.mainDocument) {
        updatePayload.mainDocumentId        = dto.mainDocument.storageKey;
        updatePayload.mainDocumentValidated = true;
        updatePayload.mainDocumentMetadata  = {
          storageKey:    dto.mainDocument.storageKey,
          originalName:  dto.mainDocument.originalName,
          mimeType:      dto.mainDocument.mimeType,
          fileSizeBytes: dto.mainDocument.fileSizeBytes ?? null,
        };
      }

      if (dto.finalUserIds !== undefined) {
        updatePayload.finalUserIds = dto.finalUserIds;
      }

      if (Object.keys(updatePayload).length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await manager.update(Workflow, id, updatePayload as any);
      }

      if (dto.approvers) {
        await manager.delete(WorkflowApprovalStep, { workflowId: id });
        const sorted = [...dto.approvers].sort((a, b) => a.stepOrder - b.stepOrder);
        const steps  = sorted.map((a) =>
          manager.create(WorkflowApprovalStep, {
            workflowId: id,
            userId:     a.userId,
            stepOrder:  a.stepOrder,
            status:     ApprovalStepStatus.WAITING,
          }),
        );
        await manager.save(WorkflowApprovalStep, steps);
      }

      if (dto.attachments !== undefined) {
        await manager.delete(WorkflowAttachment, { workflowId: id, attachmentType: AttachmentType.SUPPORTING });
        if (dto.attachments.length) {
          const attachments = dto.attachments.map((att) =>
            manager.create(WorkflowAttachment, {
              workflowId:     id,
              uploadedBy:     userId,
              documentId:     att.storageKey,
              storageKey:     att.storageKey,
              originalName:   att.originalName,
              mimeType:       att.mimeType,
              fileSizeBytes:  att.fileSizeBytes ?? null,
              attachmentType: AttachmentType.SUPPORTING,
            }),
          );
          await manager.save(WorkflowAttachment, attachments);
        }
      }
    });

    if (Object.keys(changes).length > 0) {
      await this.timelineService.record({
        workflowId:   id,
        orgId:        workflow.orgId,
        eventType:    TimelineEventType.WORKFLOW_UPDATED,
        actorId:      userId,
        resourceName: dto.title ?? workflow.title,
        description:  `Workflow "${dto.title ?? workflow.title}" actualizado.`,
        metadata:     { changes },
      });
    }

    return this.findOneOrFail(id, user);
  }

  // ── Eliminar workflow (soft delete) ──────────────────────────────────────────

  async remove(id: string, user: JwtPayload): Promise<void> {
    const userId   = user.sub!;
    const workflow = await this.workflowRepo.findOne({ where: { id } });
    if (!workflow) throw new NotFoundException('Workflow not found');

    // [RN-17] Solo DRAFT y CANCELLED pueden eliminarse sin permiso especial
    const isDeletableStatus = [WorkflowStatus.DRAFT, WorkflowStatus.CANCELLED].includes(workflow.status);
    if (!isDeletableStatus && !user.isSuperAdmin) {
      throw new ConflictException(
        'Cannot delete a workflow that has started approval. Only DRAFT or CANCELLED workflows can be deleted.',
      );
    }

    if (workflow.createdBy !== userId && !user.isSuperAdmin) {
      throw new ForbiddenException('Only the workflow creator can delete it');
    }

    await this.workflowRepo.softDelete(id);

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_CANCELLED, {
      workflowId: id,
      orgId:      workflow.orgId,
      cancelledBy: userId,
      timestamp:  new Date().toISOString(),
    });
  }

  // ── Notificar sin usuarios finales elegibles ──────────────────────────────────

  async notifyNoFinalUsers(dto: NotifyNoFinalUsersDto, user: JwtPayload): Promise<void> {
    const orgId = user.companyId!;

    this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
      type:             'NO_FINAL_USER_ALERT',
      recipientUserIds: dto.recipientIds,
      workflowId:       null,
      workflowTitle:    null,
      message:          `Alerta: la tipología "${dto.typologyName}" no tiene usuarios configurados como usuarios finales. Es necesario asignar el cargo, área o departamento correcto a los usuarios de la organización.`,
      metadata: {
        typologyId:   dto.typologyId,
        typologyName: dto.typologyName,
        reportedBy:   user.sub,
        orgId,
      },
      timestamp: new Date().toISOString(),
    });
  }

  // ── Obtener timeline ──────────────────────────────────────────────────────────

  async getTimeline(id: string, user: JwtPayload): Promise<TimelineEventResponseDto[]> {
    await this.findOneOrFail(id, user); // valida acceso
    const events = await this.timelineService.getTimeline(id);
    return events.map(TimelineEventResponseDto.from);
  }

  // ── Helpers privados ──────────────────────────────────────────────────────────

  private validateApproverStepOrders(approvers: { stepOrder: number }[]): void {
    const orders = approvers.map((a) => a.stepOrder).sort((a, b) => a - b);
    if (orders[0] !== 1 || orders.some((o, i) => i > 0 && o !== orders[i - 1] + 1)) {
      throw new BadRequestException('Approver stepOrders must be consecutive starting from 1');
    }
    if (new Set(orders).size !== orders.length) {
      throw new BadRequestException('Duplicate stepOrder values in approvers');
    }
  }

  async getStats(orgId: string, userId?: string): Promise<{
    totalWorkflows: number;
    statusCounts: Record<string, number>;
    myPendingTasks: number;
    weeklyTrend: { week: string; count: number }[];
    storageTotalBytes: number;
    totalAttachments: number;
  }> {
    const [totalWorkflows, statusRows, myPendingTasks] = await Promise.all([
      this.workflowRepo.count({ where: { orgId } }),
      this.workflowRepo
        .createQueryBuilder('w')
        .select('w.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .where('w.orgId = :orgId', { orgId })
        .groupBy('w.status')
        .getRawMany<{ status: string; count: string }>(),
      userId
        ? this.workflowRepo.count({
            where: [
              { orgId, currentAssignedUserId: userId, status: WorkflowStatus.PENDING_APPROVAL },
              { orgId, currentAssignedUserId: userId, status: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS },
            ],
          })
        : Promise.resolve(0),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const row of statusRows) {
      statusCounts[row.status] = parseInt(row.count, 10);
    }

    // 8 weeks trend (week start date label MM/DD)
    const weeks: { week: string; count: number }[] = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      const count = await this.workflowRepo
        .createQueryBuilder('w')
        .where('w.orgId = :orgId', { orgId })
        .andWhere('w.createdAt >= :start', { start: weekStart })
        .andWhere('w.createdAt < :end', { end: weekEnd })
        .getCount();
      const mm = String(weekStart.getMonth() + 1).padStart(2, '0');
      const dd = String(weekStart.getDate()).padStart(2, '0');
      weeks.push({ week: `${mm}/${dd}`, count });
    }

    // Storage: workflow_attachments + workflow_admin_attachments joined via org
    const storageRow = await this.dataSource.query<{ total_bytes: string; total_files: string }[]>(`
      SELECT
        COALESCE(SUM(bytes), 0)::text AS total_bytes,
        COUNT(*)::text                AS total_files
      FROM (
        SELECT wa.file_size_bytes AS bytes
        FROM   workflow_attachments wa
        JOIN   workflows w ON w.id = wa.workflow_id
        WHERE  w.org_id = $1 AND wa.file_size_bytes IS NOT NULL
        UNION ALL
        SELECT waa.file_size_bytes AS bytes
        FROM   workflow_admin_attachments waa
        JOIN   workflow_admin_steps was ON was.id = waa.step_id
        JOIN   workflow_admin_cycles wac ON wac.id = was.cycle_id
        JOIN   workflows w ON w.id = wac.workflow_id
        WHERE  w.org_id = $1 AND waa.file_size_bytes IS NOT NULL
      ) sub
    `, [orgId]);

    const storageTotalBytes = parseInt(storageRow[0]?.total_bytes ?? '0', 10);
    const totalAttachments  = parseInt(storageRow[0]?.total_files ?? '0', 10);

    return { totalWorkflows, statusCounts, myPendingTasks, weeklyTrend: weeks, storageTotalBytes, totalAttachments };
  }

  async getStoragePerOrg(): Promise<{ orgId: string; storageTotalBytes: number; totalAttachments: number }[]> {
    const rows = await this.dataSource.query<{ org_id: string; total_bytes: string; total_files: string }[]>(`
      SELECT
        w.org_id,
        COALESCE(SUM(bytes), 0)::text AS total_bytes,
        COUNT(*)::text                AS total_files
      FROM (
        SELECT wa.workflow_id, wa.file_size_bytes AS bytes
        FROM   workflow_attachments wa
        WHERE  wa.file_size_bytes IS NOT NULL
        UNION ALL
        SELECT wac.workflow_id, waa.file_size_bytes AS bytes
        FROM   workflow_admin_attachments waa
        JOIN   workflow_admin_steps was ON was.id = waa.step_id
        JOIN   workflow_admin_cycles wac ON wac.id = was.cycle_id
        WHERE  waa.file_size_bytes IS NOT NULL
      ) sub
      JOIN workflows w ON w.id = sub.workflow_id
      GROUP BY w.org_id
      ORDER BY total_bytes DESC
    `);

    return rows.map((r) => ({
      orgId:            r.org_id,
      storageTotalBytes: parseInt(r.total_bytes, 10),
      totalAttachments:  parseInt(r.total_files, 10),
    }));
  }

  private async findOneOrFail(id: string, user: JwtPayload): Promise<WorkflowResponseDto> {
    const orgId    = user.companyId!;
    const workflow = await this.workflowRepo.findOne({
      where: { id, orgId },
      relations: ['approvalSteps', 'attachments'],
    });

    if (!workflow) throw new NotFoundException('Workflow not found');

    const actions = await this.actionRepo.find({
      where: { workflowId: id },
      order: { createdAt: 'ASC' },
    });

    // Load all admin cycles with steps, notes and attachments
    const allAdminCycles = await this.dataSource.getRepository(WorkflowAdminCycle).find({
      where: { workflowId: id },
      relations: ['steps', 'steps.notes', 'steps.attachments'],
      order: { cycleNumber: 'ASC' },
    });

    const activeAdminCycle = workflow.activeAdminCycleId
      ? (allAdminCycles.find((c) => c.id === workflow.activeAdminCycleId) ?? null)
      : null;

    return WorkflowResponseDto.from(workflow, actions, activeAdminCycle ?? undefined, allAdminCycles);
  }
}

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
import { KafkaProducerService, AppLogger, JwtPayload, TOPICS } from '@sgd/common';
import { DocumentClientService } from '../common/clients/document-client.service';
import { UserClientService } from '../common/clients/user-client.service';

@Injectable()
export class WorkflowsService {
  // Bounds how long a single workflow detail read can be blocked by the
  // best-effort reviewCycleEnabled refresh in findOneOrFail — much shorter
  // than the shared DOCUMENT_SERVICE_TIMEOUT_MS used by approve()/
  // createCycle(), where waiting the full timeout for an authoritative
  // decision is worth it. Here a slow-but-alive document-service should just
  // fall back to the stale snapshot (via the try/catch around the call)
  // sooner rather than stall the whole read.
  private static readonly REVIEW_CYCLE_REFRESH_TIMEOUT_MS = 1_500;

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
    private readonly userClientService: UserClientService,
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
        reviewCycleEnabled:    typologyInfo.reviewCycleEnabled,
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
    if (dto.search) {
      const trimmed = dto.search.trim();
      if (trimmed) {
        const term = `%${trimmed}%`;
        qb.andWhere('(w.title ILIKE :term OR w.description ILIKE :term)', { term });
      }
    }

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

    const [assignedWorkflows, draftWorkflows] = await Promise.all([
      this.workflowRepo
        .createQueryBuilder('w')
        .leftJoinAndSelect('w.approvalSteps', 'steps')
        .where('w.org_id = :orgId', { orgId })
        .andWhere('w.current_assigned_user_id = :userId', { userId })
        .andWhere('w.status IN (:...statuses)', {
          statuses: [WorkflowStatus.PENDING_APPROVAL, WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS, WorkflowStatus.PENDING_REVIEW_CYCLE],
        })
        .andWhere('w.deleted_at IS NULL')
        .orderBy('w.updatedAt', 'DESC')
        .take(100)
        .getMany(),

      // El creador ve sus DRAFT en "Mis tareas" para poder enviarlos a aprobación
      this.workflowRepo
        .createQueryBuilder('w')
        .leftJoinAndSelect('w.approvalSteps', 'steps')
        .where('w.org_id = :orgId', { orgId })
        .andWhere('w.created_by = :userId', { userId })
        .andWhere('w.status = :draft', { draft: WorkflowStatus.DRAFT })
        .andWhere('w.deleted_at IS NULL')
        .orderBy('w.updatedAt', 'DESC')
        .take(100)
        .getMany(),
    ]);

    const merged = new Map<string, Workflow>();
    for (const w of [...assignedWorkflows, ...draftWorkflows]) {
      merged.set(w.id, w);
    }

    return Array.from(merged.values()).map((w) => WorkflowResponseDto.from(w));
  }

  // ── Historial de workflows del usuario ("Mis flujos") ─────────────────────────
  // No es solo "disponibles ahora": incluye cualquier workflow donde el usuario
  // haya participado (usuario final, revisor de ciclo, aprobador o creador), en
  // cualquier desenlace — disponible, en ciclo, rechazado o cerrado — para que
  // pueda ver el resultado sin depender de otra pestaña.

  async getMyAvailable(user: JwtPayload): Promise<WorkflowResponseDto[]> {
    const userId = user.sub!;
    const orgId  = user.companyId!;

    // 1. Workflows donde el usuario es usuario final
    // REJECTED y CLOSED se incluyen para que el usuario final pueda ver el
    // desenlace de flujos que le fueron notificados, incluso ya finalizados.
    const finalUserWorkflows = await this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.approvalSteps', 'steps')
      .where('w.org_id = :orgId', { orgId })
      .andWhere(':userId = ANY(w.final_user_ids)', { userId })
      .andWhere('w.status IN (:...statuses)', {
        statuses: [
          WorkflowStatus.AVAILABLE_FOR_FINAL_USERS,
          WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS,
          WorkflowStatus.REJECTED,
          WorkflowStatus.CLOSED,
        ],
      })
      .andWhere('w.deleted_at IS NULL')
      .orderBy('w.updatedAt', 'DESC')
      .take(100)
      .getMany();

    // 2. Workflows donde el usuario tiene un paso opcional PENDING en un ciclo activo
    const optionalReviewerWorkflows = await this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.approvalSteps', 'steps')
      .where('w.org_id = :orgId', { orgId })
      .andWhere('w.status = :wStatus', { wStatus: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS })
      .andWhere('w.deleted_at IS NULL')
      .andWhere(
        `EXISTS (
          SELECT 1 FROM workflow_admin_cycles c
          INNER JOIN workflow_admin_steps s ON s.cycle_id = c.id
          WHERE c.workflow_id = w.id
            AND c.status = 'IN_PROGRESS'
            AND s.user_id = :userId
            AND s.status = 'PENDING'
            AND s.is_optional = true
        )`,
        { userId },
      )
      .orderBy('w.updatedAt', 'DESC')
      .take(100)
      .getMany();

    // 3. Workflows donde el usuario está en allowedOptionalReviewerIds de un ciclo activo
    //    (puede ser llamado como revisor opcional en cualquier momento del ciclo)
    const allowedOptionalWorkflows = await this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.approvalSteps', 'steps')
      .where('w.org_id = :orgId', { orgId })
      .andWhere('w.status = :wStatus', { wStatus: WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS })
      .andWhere('w.deleted_at IS NULL')
      .andWhere(
        `EXISTS (
          SELECT 1 FROM workflow_admin_cycles c
          WHERE c.workflow_id = w.id
            AND c.status = 'IN_PROGRESS'
            AND CAST(:userId2 AS UUID) = ANY(c.allowed_optional_reviewer_ids)
        )`,
        { userId2: userId },
      )
      .orderBy('w.updatedAt', 'DESC')
      .take(100)
      .getMany();

    // 4. Workflows donde el usuario participó como revisor (obligatorio u opcional)
    //    en algún ciclo administrativo — cubre tanto el ciclo aún activo tras
    //    completar su paso como el desenlace final del workflow, sin importar
    //    si terminó disponible, rechazado o cerrado.
    const pastAdminReviewerWorkflows = await this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.approvalSteps', 'steps')
      .where('w.org_id = :orgId', { orgId })
      .andWhere('w.status IN (:...visibleStatuses)', {
        visibleStatuses: [
          WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS,
          WorkflowStatus.AVAILABLE_FOR_FINAL_USERS,
          WorkflowStatus.REJECTED,
          WorkflowStatus.CLOSED,
        ],
      })
      .andWhere('w.deleted_at IS NULL')
      .andWhere(
        `EXISTS (
          SELECT 1 FROM workflow_admin_cycles c
          INNER JOIN workflow_admin_steps s ON s.cycle_id = c.id
          WHERE c.workflow_id = w.id
            AND s.user_id = :userId
        )`,
        { userId },
      )
      .orderBy('w.updatedAt', 'DESC')
      .take(100)
      .getMany();

    // 5. Workflows creados por el usuario (el creador siempre ve sus propios workflows
    //    en cualquier estado activo o terminal relevante para él, incluyendo rechazados,
    //    devueltos y cerrados, para que pueda ver el resultado sin necesitar WORKFLOWS:MANAGE).
    const createdByUserWorkflows = await this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.approvalSteps', 'steps')
      .where('w.org_id = :orgId', { orgId })
      .andWhere('w.created_by = :userId', { userId })
      .andWhere('w.status IN (:...creatorStatuses)', {
        creatorStatuses: [
          WorkflowStatus.AVAILABLE_FOR_FINAL_USERS,
          WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS,
          WorkflowStatus.REJECTED,
          WorkflowStatus.RETURNED_TO_CREATOR,
          WorkflowStatus.CLOSED,
        ],
      })
      .andWhere('w.deleted_at IS NULL')
      .orderBy('w.updatedAt', 'DESC')
      .take(100)
      .getMany();

    // 6. Workflows donde el usuario es un aprobador definido (workflow_approval_steps)
    //    Una vez que el flujo llega a AVAILABLE_FOR_FINAL_USERS, REJECTED o CLOSED, el
    //    aprobador debe poder ver el resultado en la pestaña "Mis flujos".
    const approverWorkflows = await this.workflowRepo
      .createQueryBuilder('w')
      .leftJoinAndSelect('w.approvalSteps', 'steps')
      .where('w.org_id = :orgId', { orgId })
      .andWhere('w.status IN (:...approverStatuses)', {
        approverStatuses: [
          WorkflowStatus.AVAILABLE_FOR_FINAL_USERS,
          WorkflowStatus.REJECTED,
          WorkflowStatus.CLOSED,
        ],
      })
      .andWhere('w.deleted_at IS NULL')
      .andWhere(
        `EXISTS (
          SELECT 1 FROM workflow_approval_steps s
          WHERE s.workflow_id = w.id
            AND s.user_id = :userId
        )`,
        { userId },
      )
      .orderBy('w.updatedAt', 'DESC')
      .take(100)
      .getMany();

    // Combinar y deduplicar por id
    const merged = new Map<string, Workflow>();
    for (const w of [
      ...finalUserWorkflows,
      ...optionalReviewerWorkflows,
      ...allowedOptionalWorkflows,
      ...pastAdminReviewerWorkflows,
      ...createdByUserWorkflows,
      ...approverWorkflows,
    ]) {
      merged.set(w.id, w);
    }

    this.logger.log(
      `getMyAvailable userId=${userId} ` +
      `finalUser=${finalUserWorkflows.length} ` +
      `optionalStep=${optionalReviewerWorkflows.length} ` +
      `allowedOptional=${allowedOptionalWorkflows.length} ` +
      `pastAdminReviewer=${pastAdminReviewerWorkflows.length} ` +
      `createdBy=${createdByUserWorkflows.length} ` +
      `approver=${approverWorkflows.length} ` +
      `total=${merged.size}`,
    );

    return Array.from(merged.values()).map((w) => WorkflowResponseDto.from(w));
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
      orgId,
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
    // Only validates access (org-scoped existence) — deliberately NOT
    // findOneOrFail, which also resolves participant names via its own
    // getUsersByIds batch call. That result would be thrown away here anyway,
    // and it'd mean two separate user-service round-trips per request.
    await this.findWorkflowOrFail(id, user);
    const events = await this.timelineService.getTimeline(id);

    // Resolved here (not left to the frontend) so the timeline shows actor names
    // regardless of whether the viewer's role has USERS:READ — best-effort: on
    // failure getUsersByIds returns an empty map and events just fall back to null.
    const actorIds = [...new Set(events.map((e) => e.actorId))];
    const usersById = await this.userClientService.getUsersByIds(actorIds);

    return events.map((event) =>
      TimelineEventResponseDto.from(event, usersById.get(event.actorId)?.displayName ?? null),
    );
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
        .where('w.org_id = :orgId', { orgId })
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

    // 8 weeks trend (week start date label MM/DD) — single GROUP BY query
    const now = new Date();
    const weekStarts: Date[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i * 7);
      const ws = new Date(d);
      ws.setDate(d.getDate() - d.getDay());
      ws.setHours(0, 0, 0, 0);
      weekStarts.push(ws);
    }
    const earliest = weekStarts[0];
    const latest = new Date(weekStarts[weekStarts.length - 1]);
    latest.setDate(latest.getDate() + 7);

    const trendRows = await this.dataSource.query<{ week_start: string; count: string }[]>(`
      SELECT
        to_char(
          date_trunc('week', created_at + interval '1 day') - interval '1 day',
          'YYYY-MM-DD'
        ) AS week_start,
        COUNT(*)::text AS count
      FROM workflows
      WHERE org_id = $1
        AND created_at >= $2
        AND created_at < $3
        AND deleted_at IS NULL
      GROUP BY 1
      ORDER BY 1
    `, [orgId, earliest, latest]);

    const countByWeek = new Map(trendRows.map((r) => [r.week_start, parseInt(r.count, 10)]));
    const weeks = weekStarts.map((ws) => {
      const key = ws.toISOString().slice(0, 10);
      const mm = String(ws.getMonth() + 1).padStart(2, '0');
      const dd = String(ws.getDate()).padStart(2, '0');
      return { week: `${mm}/${dd}`, count: countByWeek.get(key) ?? 0 };
    });

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
        COALESCE(SUM(bytes), 0)       AS total_bytes_num,
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
      ORDER BY total_bytes_num DESC
    `);

    return rows.map((r) => ({
      orgId:            r.org_id,
      storageTotalBytes: parseInt(r.total_bytes, 10),
      totalAttachments:  parseInt(r.total_files, 10),
    }));
  }

  // Org-scoped existence check only — no actions/admin-cycle loading or
  // participant-name resolution. Used by callers that just need to validate
  // access (e.g. getTimeline) without paying for the full detail enrichment.
  private async findWorkflowOrFail(id: string, user: JwtPayload): Promise<Workflow> {
    const orgId    = user.companyId!;
    const workflow = await this.workflowRepo.findOne({
      where: { id, orgId },
      relations: ['approvalSteps', 'attachments', 'notes'],
    });

    if (!workflow) throw new NotFoundException('Workflow not found');
    return workflow;
  }

  private async findOneOrFail(id: string, user: JwtPayload): Promise<WorkflowResponseDto> {
    const workflow = await this.findWorkflowOrFail(id, user);

    // El botón "Iniciar ciclo de revisión" del frontend depende de
    // reviewCycleEnabled — para una lectura de UN SOLO workflow (nunca una
    // lista/paginada, así que no hay riesgo de N+1) se refresca en vivo
    // contra document-service en los estados donde realmente importa, en vez
    // de servir la instantánea de creación/última aprobación, que puede haber
    // quedado desactualizada si la tipología cambió mientras el workflow
    // esperaba acción del usuario final.
    //
    // A diferencia de approve()/createCycle() (donde un false autoritativo
    // conduce una transición de estado y por eso un fallo de document-service
    // debe propagarse), este es solo un refresco de UI best-effort sobre una
    // lectura — nunca debe tumbar la vista de detalle de un workflow porque
    // document-service esté caído momentáneamente. Ante fallo, se conserva la
    // instantánea existente y se registra la advertencia.
    if (
      workflow.status === WorkflowStatus.PENDING_REVIEW_CYCLE ||
      workflow.status === WorkflowStatus.AVAILABLE_FOR_FINAL_USERS
    ) {
      try {
        const liveReviewCycleEnabled = await this.documentClientService.isReviewCycleEnabledForTypology(
          workflow.orgId,
          workflow.typologyId,
          WorkflowsService.REVIEW_CYCLE_REFRESH_TIMEOUT_MS,
        );
        if (liveReviewCycleEnabled !== workflow.reviewCycleEnabled) {
          workflow.reviewCycleEnabled = liveReviewCycleEnabled;
          await this.workflowRepo.update(id, { reviewCycleEnabled: liveReviewCycleEnabled });
        }
      } catch (error: unknown) {
        this.logger.warn(
          `Could not refresh reviewCycleEnabled for workflow ${id}, serving stale snapshot: ${
            error instanceof Error ? error.message : String(error)
          }`,
          'WorkflowsService',
        );
      }
    }

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

    const participantNames = await this.resolveParticipantNames(workflow, actions, allAdminCycles);

    return WorkflowResponseDto.from(
      workflow,
      actions,
      activeAdminCycle ?? undefined,
      allAdminCycles,
      participantNames,
    );
  }

  /**
   * Collects every user ID referenced anywhere in a workflow (creator, approval
   * steps/actions, admin cycle steps, final users, allowed optional reviewers)
   * and resolves their display names in one batch call — so the detail view
   * and dialogs like ForwardStepDialog can show who's involved without
   * requiring the viewer's role to hold USERS:READ.
   */
  private async resolveParticipantNames(
    workflow: Workflow,
    actions: WorkflowApprovalAction[],
    allAdminCycles: WorkflowAdminCycle[],
  ): Promise<Record<string, string>> {
    const ids = new Set<string>([workflow.createdBy]);
    if (workflow.closedBy) ids.add(workflow.closedBy);
    if (workflow.cancelledBy) ids.add(workflow.cancelledBy);
    if (workflow.currentAssignedUserId) ids.add(workflow.currentAssignedUserId);
    for (const userId of workflow.finalUserIds ?? []) ids.add(userId);
    for (const step of workflow.approvalSteps ?? []) ids.add(step.userId);
    for (const action of actions) ids.add(action.userId);
    for (const cycle of allAdminCycles) {
      ids.add(cycle.initiatedBy);
      for (const step of cycle.steps ?? []) ids.add(step.userId);
      // Users allowed to be picked as the optional reviewer when forwarding an
      // admin step — shown in ForwardStepDialog's selector, which otherwise
      // has no other way to resolve their names without USERS:READ.
      for (const id of cycle.allowedOptionalReviewerIds ?? []) ids.add(id);
    }

    const usersById = await this.userClientService.getUsersByIds([...ids]);
    // Omit entries with no resolvable name (displayName: null) instead of
    // putting null in a Record<string, string> — the frontend already falls
    // back to "unknown user" for any id missing from this map.
    return Object.fromEntries(
      [...usersById]
        .filter((entry): entry is [string, { id: string; displayName: string }] =>
          entry[1].displayName !== null,
        )
        .map(([id, u]) => [id, u.displayName]),
    );
  }
}

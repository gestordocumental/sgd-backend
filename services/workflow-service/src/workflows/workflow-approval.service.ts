import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Workflow } from './entities/workflow.entity';
import { WorkflowApprovalStep } from './entities/workflow-approval-step.entity';
import { WorkflowApprovalAction } from './entities/workflow-approval-action.entity';
import {
  WorkflowStatus,
  ApprovalStepStatus,
  ApprovalActionType,
  TimelineEventType,
} from './entities/enums';
import { ApproveWorkflowDto } from './dto/approve-workflow.dto';
import { RejectWorkflowDto } from './dto/reject-workflow.dto';
import { ResubmitWorkflowDto } from './dto/resubmit-workflow.dto';
import { WorkflowTimelineService } from './workflow-timeline.service';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';
import { UserClientService } from '../common/clients/user-client.service';
import { TOPICS } from '../common/kafka/kafka.constants';
import { AppLogger } from '../common/logger/app-logger.service';

@Injectable()
export class WorkflowApprovalService {
  constructor(
    @InjectRepository(Workflow)
    private readonly workflowRepo: Repository<Workflow>,
    @InjectRepository(WorkflowApprovalStep)
    private readonly stepRepo: Repository<WorkflowApprovalStep>,
    @InjectRepository(WorkflowApprovalAction)
    private readonly actionRepo: Repository<WorkflowApprovalAction>,
    private readonly dataSource: DataSource,
    private readonly timelineService: WorkflowTimelineService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly userClientService: UserClientService,
    private readonly logger: AppLogger,
  ) {}

  // ── Iniciar ciclo de aprobación ──────────────────────────────────────────────

  async startApproval(workflowId: string, userId: string): Promise<Workflow> {
    const workflow = await this.workflowRepo.findOne({
      where: { id: workflowId },
      relations: ['approvalSteps'],
    });

    if (!workflow) throw new BadRequestException('Workflow not found');

    // [RN-01] Solo el creador puede iniciar la aprobación
    if (workflow.createdBy !== userId) {
      throw new ForbiddenException('Only the workflow creator can start approval');
    }

    // [RN-01] Estado debe ser DRAFT
    if (workflow.status !== WorkflowStatus.DRAFT) {
      throw new ConflictException(
        `Cannot start approval: workflow status is ${workflow.status}`,
      );
    }

    // [RN-02] Debe tener al menos un aprobador
    const steps = workflow.approvalSteps ?? [];
    if (steps.length === 0) {
      throw new BadRequestException('Cannot start approval: no approvers defined');
    }

    // [RN-03] Documento principal debe estar validado
    if (!workflow.mainDocumentValidated) {
      throw new BadRequestException(
        'Cannot start approval: main document has not been validated',
      );
    }

    // Ordenar pasos y activar el primero
    const sorted = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const firstStep = sorted[0];

    await this.dataSource.transaction(async (manager) => {
      // Activar primer paso
      await manager.update(WorkflowApprovalStep, firstStep.id, {
        status: ApprovalStepStatus.PENDING,
      });

      // Actualizar workflow
      await manager.update(Workflow, workflowId, {
        status:                   WorkflowStatus.PENDING_APPROVAL,
        currentApprovalStepOrder: firstStep.stepOrder,
        currentAssignedUserId:    firstStep.userId,
      });

      await this.timelineService.record({
        workflowId,
        orgId:       workflow.orgId,
        eventType:   TimelineEventType.APPROVAL_STARTED,
        actorId:     userId,
        targetUserId: firstStep.userId,
        description: `Ciclo de aprobación iniciado. Aprobador asignado: paso ${firstStep.stepOrder}`,
        metadata:    { firstApproverUserId: firstStep.userId, stepOrder: firstStep.stepOrder },
      }, manager);
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_APPROVAL_STARTED, {
      workflowId,
      orgId:            workflow.orgId,
      firstApproverId:  firstStep.userId,
      createdBy:        workflow.createdBy,
      timestamp:        new Date().toISOString(),
    });

    this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
      type:             'WORKFLOW_TASK_ASSIGNED',
      recipientUserIds: [firstStep.userId],
      workflowId,
      workflowTitle:    workflow.title,
      message:          `Tienes una solicitud de aprobación pendiente: "${workflow.title}"`,
      metadata:         { stepOrder: firstStep.stepOrder },
      timestamp:        new Date().toISOString(),
    });

    return this.workflowRepo.findOneOrFail({
      where: { id: workflowId },
      relations: ['approvalSteps'],
    });
  }

  // ── Aprobar ──────────────────────────────────────────────────────────────────

  async approve(
    workflowId: string,
    userId: string,
    dto: ApproveWorkflowDto,
  ): Promise<Workflow> {
    const workflow = await this.workflowRepo.findOne({
      where: { id: workflowId },
      relations: ['approvalSteps'],
    });

    if (!workflow) throw new BadRequestException('Workflow not found');

    if (workflow.status !== WorkflowStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Cannot approve: workflow status is ${workflow.status}`,
      );
    }

    // [RN-04] Solo el aprobador actual puede aprobar
    if (workflow.currentAssignedUserId !== userId) {
      throw new ForbiddenException('You are not the current approver for this workflow');
    }

    const currentStep = workflow.approvalSteps.find(
      (s) => s.stepOrder === workflow.currentApprovalStepOrder && s.status === ApprovalStepStatus.PENDING,
    );
    if (!currentStep) throw new BadRequestException('Current approval step not found');

    // Calcular attempt_number para este step
    const existingActionsCount = await this.actionRepo.count({
      where: { stepId: currentStep.id },
    });

    const sortedSteps = [...workflow.approvalSteps].sort((a, b) => a.stepOrder - b.stepOrder);
    const nextStep    = sortedSteps.find((s) => s.stepOrder > currentStep.stepOrder);
    const isLast      = !nextStep;

    await this.dataSource.transaction(async (manager) => {
      // Registrar acción de aprobación
      await manager.save(WorkflowApprovalAction, {
        workflowId,
        stepId:        currentStep.id,
        userId,
        action:        ApprovalActionType.APPROVED,
        observations:  dto.observations ?? null,
        attemptNumber: existingActionsCount + 1,
        attachments:   (dto.attachments ?? []).map((a) => ({
          storageKey:    a.storageKey,
          originalName:  a.originalName,
          mimeType:      a.mimeType,
          fileSizeBytes: a.fileSizeBytes ?? null,
        })),
      });

      // Marcar step actual como aprobado
      await manager.update(WorkflowApprovalStep, currentStep.id, {
        status:      ApprovalStepStatus.APPROVED,
        completedAt: new Date(),
      });

      if (isLast) {
        // Último aprobador — el workflow pasa a PENDING_REVIEW_CYCLE para que el usuario final configure el ciclo de revisión
        await manager.update(Workflow, workflowId, {
          status:                   WorkflowStatus.PENDING_REVIEW_CYCLE,
          currentApprovalStepOrder: null,
          currentAssignedUserId:    (workflow.finalUserIds?.[0]) ?? null,
        });
      } else {
        // Hay más aprobadores — activar siguiente paso
        await manager.update(WorkflowApprovalStep, nextStep!.id, {
          status: ApprovalStepStatus.PENDING,
        });
        await manager.update(Workflow, workflowId, {
          currentApprovalStepOrder: nextStep!.stepOrder,
          currentAssignedUserId:    nextStep!.userId,
        });
      }

      await this.timelineService.record({
        workflowId,
        orgId:       workflow.orgId,
        eventType:   TimelineEventType.STEP_APPROVED,
        actorId:     userId,
        targetUserId: isLast ? null : (nextStep?.userId ?? null),
        description: isLast
          ? `Aprobación final completada por paso ${currentStep.stepOrder}. Workflow disponible para usuarios finales.`
          : `Paso ${currentStep.stepOrder} aprobado. Siguiente aprobador: paso ${nextStep!.stepOrder}`,
        metadata: {
          stepOrder:       currentStep.stepOrder,
          observations:    dto.observations ?? null,
          isLastApprover:  isLast,
          nextStepOrder:   isLast ? null : nextStep!.stepOrder,
          attachmentCount: (dto.attachments ?? []).length,
        },
      }, manager);
    });

    if (isLast) {
      // Si el creador ya seleccionó los usuarios finales al crear el workflow, usarlos directamente
      const finalUserIds = (workflow.finalUserIds?.length ?? 0) > 0
        ? workflow.finalUserIds!
        : await this.resolveFinalUsers(workflow);

      // Guardar snapshot de usuarios finales (actualiza si ya estaba, por si acaso)
      await this.workflowRepo.update(workflowId, { finalUserIds: finalUserIds.length > 0 ? finalUserIds : null });

      await this.timelineService.record({
        workflowId,
        orgId:       workflow.orgId,
        eventType:   TimelineEventType.WORKFLOW_APPROVED,
        actorId:     userId,
        description: `Aprobado. Pendiente de ciclo de revisión. (${finalUserIds.length} usuario(s) final(es) asignado(s))`,
        metadata:    { finalUserIds },
      });

      this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_APPROVAL_COMPLETED, {
        workflowId,
        orgId:           workflow.orgId,
        finalApproverId: userId,
        finalUserIds,
        timestamp:       new Date().toISOString(),
      });

      this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_AVAILABLE_FOR_FINAL_USERS, {
        workflowId,
        orgId:       workflow.orgId,
        finalUserIds,
        timestamp:   new Date().toISOString(),
      });

      if (finalUserIds.length > 0) {
        this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
          type:             'WORKFLOW_APPROVED',
          recipientUserIds: finalUserIds,
          workflowId,
          workflowTitle:    workflow.title,
          message:          `El workflow "${workflow.title}" ha sido aprobado y está disponible para ti.`,
          timestamp:        new Date().toISOString(),
        });
      }
    } else {
      this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_APPROVAL_APPROVED, {
        workflowId,
        orgId:          workflow.orgId,
        approvedBy:     userId,
        stepOrder:      currentStep.stepOrder,
        nextApproverId: nextStep!.userId,
        timestamp:      new Date().toISOString(),
      });

      this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
        type:             'WORKFLOW_TASK_ASSIGNED',
        recipientUserIds: [nextStep!.userId],
        workflowId,
        workflowTitle:    workflow.title,
        message:          `Tienes una solicitud de aprobación pendiente: "${workflow.title}"`,
        metadata:         { stepOrder: nextStep!.stepOrder },
        timestamp:        new Date().toISOString(),
      });
    }

    return this.workflowRepo.findOneOrFail({
      where: { id: workflowId },
      relations: ['approvalSteps'],
    });
  }

  // ── Rechazar ─────────────────────────────────────────────────────────────────

  async reject(
    workflowId: string,
    userId: string,
    dto: RejectWorkflowDto,
  ): Promise<Workflow> {
    const workflow = await this.workflowRepo.findOne({
      where: { id: workflowId },
      relations: ['approvalSteps'],
    });

    if (!workflow) throw new BadRequestException('Workflow not found');

    if (workflow.status !== WorkflowStatus.PENDING_APPROVAL) {
      throw new ConflictException(
        `Cannot reject: workflow status is ${workflow.status}`,
      );
    }

    // [RN-06] Solo el aprobador actual puede rechazar
    if (workflow.currentAssignedUserId !== userId) {
      throw new ForbiddenException('You are not the current approver for this workflow');
    }

    const currentStep = workflow.approvalSteps.find(
      (s) => s.stepOrder === workflow.currentApprovalStepOrder && s.status === ApprovalStepStatus.PENDING,
    );
    if (!currentStep) throw new BadRequestException('Current approval step not found');

    const existingActionsCount = await this.actionRepo.count({
      where: { stepId: currentStep.id },
    });

    await this.dataSource.transaction(async (manager) => {
      // Registrar acción de rechazo
      await manager.save(WorkflowApprovalAction, {
        workflowId,
        stepId:        currentStep.id,
        userId,
        action:        ApprovalActionType.REJECTED,
        observations:  dto.observations,
        attemptNumber: existingActionsCount + 1,
      });

      // El step rechazado vuelve a WAITING — esperará el reenvío
      await manager.update(WorkflowApprovalStep, currentStep.id, {
        status: ApprovalStepStatus.REJECTED,
      });

      // Workflow regresa al creador
      await manager.update(Workflow, workflowId, {
        status:                WorkflowStatus.RETURNED_TO_CREATOR,
        rejectedAtStepId:      currentStep.id,
        currentAssignedUserId: workflow.createdBy,
      });

      await this.timelineService.record({
        workflowId,
        orgId:       workflow.orgId,
        eventType:   TimelineEventType.STEP_REJECTED,
        actorId:     userId,
        targetUserId: workflow.createdBy,
        description: `Paso ${currentStep.stepOrder} rechazado. Workflow devuelto al creador.`,
        metadata:    {
          stepOrder:    currentStep.stepOrder,
          observations: dto.observations,
          rejectedBy:   userId,
        },
      }, manager);

      await this.timelineService.record({
        workflowId,
        orgId:       workflow.orgId,
        eventType:   TimelineEventType.WORKFLOW_RETURNED_TO_CREATOR,
        actorId:     userId,
        targetUserId: workflow.createdBy,
        description: `Workflow devuelto al creador con observaciones.`,
        metadata:    { observations: dto.observations },
      }, manager);
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_APPROVAL_REJECTED, {
      workflowId,
      orgId:         workflow.orgId,
      rejectedBy:    userId,
      stepOrder:     currentStep.stepOrder,
      observations:  dto.observations,
      returnedTo:    workflow.createdBy,
      attemptNumber: existingActionsCount + 1,
      timestamp:     new Date().toISOString(),
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_RETURNED_TO_CREATOR, {
      workflowId,
      orgId:        workflow.orgId,
      returnedTo:   workflow.createdBy,
      rejectedBy:   userId,
      observations: dto.observations,
      timestamp:    new Date().toISOString(),
    });

    this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
      type:             'WORKFLOW_REJECTED',
      recipientUserIds: [workflow.createdBy],
      workflowId,
      workflowTitle:    workflow.title,
      message:          `Tu workflow "${workflow.title}" fue rechazado: ${dto.observations}`,
      metadata:         { stepOrder: currentStep.stepOrder, observations: dto.observations },
      timestamp:        new Date().toISOString(),
    });

    return this.workflowRepo.findOneOrFail({
      where: { id: workflowId },
      relations: ['approvalSteps'],
    });
  }

  // ── Reenviar tras rechazo ─────────────────────────────────────────────────────

  async resubmit(
    workflowId: string,
    userId: string,
    dto: ResubmitWorkflowDto,
  ): Promise<Workflow> {
    const workflow = await this.workflowRepo.findOne({
      where: { id: workflowId },
      relations: ['approvalSteps'],
    });

    if (!workflow) throw new BadRequestException('Workflow not found');

    // [RN-07] Solo se puede reenviar si está en RETURNED_TO_CREATOR
    if (workflow.status !== WorkflowStatus.RETURNED_TO_CREATOR) {
      throw new ConflictException(
        `Cannot resubmit: workflow status is ${workflow.status}`,
      );
    }

    // [RN-08] Solo el creador puede reenviar
    if (workflow.createdBy !== userId) {
      throw new ForbiddenException('Only the workflow creator can resubmit');
    }

    if (!workflow.rejectedAtStepId) {
      throw new BadRequestException('Cannot resubmit: rejected step not found');
    }

    // Encontrar el step rechazado (donde se quedó)
    const rejectedStep = workflow.approvalSteps.find(
      (s) => s.id === workflow.rejectedAtStepId,
    );
    if (!rejectedStep) throw new BadRequestException('Rejected step not found');

    await this.dataSource.transaction(async (manager) => {
      // Actualizar documento principal si fue reemplazado
      const updatePayload: Partial<Workflow> = {
        status:                   WorkflowStatus.PENDING_APPROVAL,
        currentApprovalStepOrder: rejectedStep.stepOrder,
        currentAssignedUserId:    rejectedStep.userId,
        // [RN-19] NO reinicia desde el principio — continúa desde el step rechazado
        rejectedAtStepId:         null,
      };

      if (dto.updatedMainDocumentId) {
        updatePayload.mainDocumentId        = dto.updatedMainDocumentId;
        updatePayload.mainDocumentValidated = false; // debe re-validarse
        updatePayload.mainDocumentMetadata  = null;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await manager.update(Workflow, workflowId, updatePayload as any);

      // [RN-20] El step rechazado vuelve a PENDING
      await manager.update(WorkflowApprovalStep, rejectedStep.id, {
        status:      ApprovalStepStatus.PENDING,
        completedAt: null,
      });

      await this.timelineService.record({
        workflowId,
        orgId:       workflow.orgId,
        eventType:   TimelineEventType.WORKFLOW_RESUBMITTED,
        actorId:     userId,
        targetUserId: rejectedStep.userId,
        description: `Workflow reenviado al aprobador del paso ${rejectedStep.stepOrder} tras ajustes del creador.`,
        metadata: {
          stepOrder:       rejectedStep.stepOrder,
          observations:    dto.observations ?? null,
          documentUpdated: !!dto.updatedMainDocumentId,
        },
      }, manager);
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_RESUBMITTED, {
      workflowId,
      orgId:            workflow.orgId,
      resubmittedBy:    userId,
      targetApproverId: rejectedStep.userId,
      timestamp:        new Date().toISOString(),
    });

    this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
      type:             'WORKFLOW_TASK_ASSIGNED',
      recipientUserIds: [rejectedStep.userId],
      workflowId,
      workflowTitle:    workflow.title,
      message:          `El workflow "${workflow.title}" ha sido corregido y requiere tu revisión nuevamente.`,
      metadata:         { stepOrder: rejectedStep.stepOrder },
      timestamp:        new Date().toISOString(),
    });

    return this.workflowRepo.findOneOrFail({
      where: { id: workflowId },
      relations: ['approvalSteps'],
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Consulta user-service para determinar los usuarios finales según la estructura
   * organizacional de la tipología (cargoId, areaId, departamentoId).
   */
  private async resolveFinalUsers(workflow: Workflow): Promise<string[]> {
    try {
      const metadata = workflow.mainDocumentMetadata as Record<string, string> | null;

      // La estructura org de la tipología fue guardada al validar el documento
      // Si no está disponible, retorna array vacío y log de advertencia
      const typologyOrgStructure = metadata?.['typologyOrgStructure'] as
        | { cargoId?: string; areaId?: string; departamentoId?: string }
        | undefined;

      if (!typologyOrgStructure) {
        this.logger.warn(
          `No typologyOrgStructure in mainDocumentMetadata for workflowId=${workflow.id}`,
          'WorkflowApprovalService',
        );
        return [];
      }

      const result = await this.userClientService.getUsersByPosition(workflow.orgId, {
        cargoId:        typologyOrgStructure.cargoId,
        areaId:         typologyOrgStructure.areaId,
        departamentoId: typologyOrgStructure.departamentoId,
      });

      return result.users.map((u) => u.id);
    } catch (err: unknown) {
      this.logger.error(
        `Could not resolve final users for workflowId=${workflow.id}`,
        err instanceof Error ? err.stack : String(err),
        'WorkflowApprovalService',
      );
      throw new InternalServerErrorException(
        'No se pudieron resolver los usuarios finales — user-service no disponible',
      );
    }
  }
}

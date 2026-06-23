import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { assertValidTransition } from './workflow-state-machine';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Workflow } from './entities/workflow.entity';
import { WorkflowAdminCycle } from './entities/workflow-admin-cycle.entity';
import { WorkflowAdminStep } from './entities/workflow-admin-step.entity';
import { WorkflowAdminAttachment } from './entities/workflow-admin-attachment.entity';
import { WorkflowNote } from './entities/workflow-note.entity';
import {
  WorkflowStatus,
  AdminCycleStatus,
  AdminStepStatus,
  TimelineEventType,
} from './entities/enums';
import { CreateAdminCycleDto } from './dto/create-admin-cycle.dto';
import { CompleteAdminStepDto } from './dto/complete-admin-step.dto';
import { ForwardAdminStepDto } from './dto/forward-admin-step.dto';
import { CloseWorkflowDto } from './dto/close-workflow.dto';
import { WorkflowTimelineService } from './workflow-timeline.service';
import { KafkaProducerService, TOPICS, AppLogger } from '@sgd/common';

@Injectable()
export class WorkflowAdminCycleService {
  constructor(
    @InjectRepository(Workflow)
    private readonly workflowRepo: Repository<Workflow>,
    @InjectRepository(WorkflowAdminCycle)
    private readonly cycleRepo: Repository<WorkflowAdminCycle>,
    @InjectRepository(WorkflowAdminStep)
    private readonly stepRepo: Repository<WorkflowAdminStep>,
    @InjectRepository(WorkflowAdminAttachment)
    private readonly attachmentRepo: Repository<WorkflowAdminAttachment>,
    @InjectRepository(WorkflowNote)
    private readonly noteRepo: Repository<WorkflowNote>,
    private readonly dataSource: DataSource,
    private readonly timelineService: WorkflowTimelineService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly logger: AppLogger,
  ) {}

  // ── Crear ciclo administrativo ────────────────────────────────────────────────

  async createCycle(
    workflowId: string,
    userId: string,
    dto: CreateAdminCycleDto,
  ): Promise<WorkflowAdminCycle> {
    const workflow = await this.workflowRepo.findOneOrFail({ where: { id: workflowId } });

    // [RN-11] Solo si el workflow está en PENDING_REVIEW_CYCLE o AVAILABLE_FOR_FINAL_USERS
    assertValidTransition(workflow.status, WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS);

    // [RN-12] No puede haber un ciclo activo
    if (workflow.activeAdminCycleId) {
      throw new ConflictException('There is already an active admin cycle for this workflow');
    }

    // [RN-15] Solo usuarios finales pueden iniciar ciclo admin
    const finalUserIds = workflow.finalUserIds ?? [];
    if (!finalUserIds.includes(userId)) {
      throw new ForbiddenException('Only designated final users can create admin cycles');
    }

    // Validar que los stepOrders sean únicos y consecutivos
    const orders = dto.steps.map((s) => s.stepOrder).sort((a, b) => a - b);
    const hasGap = orders.some((o, i) => i > 0 && o !== orders[i - 1] + 1);
    if (hasGap || orders[0] !== 1) {
      throw new BadRequestException('Step orders must be consecutive starting from 1');
    }
    const hasDuplicates = new Set(orders).size !== orders.length;
    if (hasDuplicates) throw new BadRequestException('Duplicate stepOrder values are not allowed');

    // Calcular número de ciclo
    const lastCycle = await this.cycleRepo.findOne({
      where: { workflowId },
      order: { cycleNumber: 'DESC' },
    });
    const cycleNumber = (lastCycle?.cycleNumber ?? 0) + 1;

    const sorted = [...dto.steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const firstStep = sorted[0];

    let savedCycle!: WorkflowAdminCycle;

    this.logger.log(
      `createCycle workflowId=${workflowId} steps=${dto.steps.length} ` +
      `allowedOptionalReviewerIds=${JSON.stringify(dto.allowedOptionalReviewerIds ?? [])}`,
    );

    await this.dataSource.transaction(async (manager) => {
      // Crear ciclo
      const cycle = manager.create(WorkflowAdminCycle, {
        workflowId,
        cycleNumber,
        initiatedBy:                userId,
        status:                     AdminCycleStatus.IN_PROGRESS,
        currentStepOrder:           1,
        allowedOptionalReviewerIds: dto.allowedOptionalReviewerIds ?? [],
      });
      savedCycle = await manager.save(WorkflowAdminCycle, cycle);

      // Crear pasos
      const steps = sorted.map((s) =>
        manager.create(WorkflowAdminStep, {
          cycleId:    savedCycle.id,
          workflowId,
          userId:     s.userId,
          stepOrder:  s.stepOrder,
          status:     s.stepOrder === 1 ? AdminStepStatus.PENDING : AdminStepStatus.WAITING,
        }),
      );
      await manager.save(WorkflowAdminStep, steps);

      // Actualizar workflow
      await manager.update(Workflow, workflowId, {
        status:              WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS,
        activeAdminCycleId:  savedCycle.id,
        currentAssignedUserId: firstStep.userId,
      });

      await this.timelineService.record({
        workflowId,
        orgId:        workflow.orgId,
        eventType:    TimelineEventType.ADMIN_CYCLE_STARTED,
        actorId:      userId,
        targetUserId: firstStep.userId,
        resourceName: workflow.title,
        description:  `Ciclo administrativo #${cycleNumber} iniciado. Primer paso asignado al usuario.`,
        metadata:     { cycleId: savedCycle.id, cycleNumber, firstUserId: firstStep.userId },
      }, manager);
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_ADMIN_CYCLE_STARTED, {
      workflowId,
      cycleId:         savedCycle.id,
      cycleNumber,
      initiatedBy:     userId,
      firstAdminUserId: firstStep.userId,
      timestamp:       new Date().toISOString(),
    });

    this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
      type:             'ADMIN_CYCLE_TASK',
      recipientUserIds: [firstStep.userId],
      orgId:            workflow.orgId,
      workflowId,
      workflowTitle:    workflow.title,
      message:          `Tienes una tarea en el ciclo administrativo del workflow "${workflow.title}"`,
      metadata:         { cycleId: savedCycle.id, stepOrder: 1 },
      timestamp:        new Date().toISOString(),
    });

    return this.cycleRepo.findOneOrFail({
      where: { id: savedCycle.id },
      relations: ['steps'],
    });
  }

  // ── Completar paso administrativo ─────────────────────────────────────────────

  async completeStep(
    workflowId: string,
    cycleId: string,
    stepId: string,
    userId: string,
    dto: CompleteAdminStepDto,
  ): Promise<WorkflowAdminStep> {
    const workflow = await this.workflowRepo.findOneOrFail({ where: { id: workflowId } });

    assertValidTransition(workflow.status, WorkflowStatus.AVAILABLE_FOR_FINAL_USERS);

    const cycle = await this.cycleRepo.findOne({
      where: { id: cycleId, workflowId },
      relations: ['steps'],
    });
    if (!cycle) throw new NotFoundException('Admin cycle not found');
    if (cycle.status !== AdminCycleStatus.IN_PROGRESS) {
      throw new ConflictException('Admin cycle is not in progress');
    }

    const step = cycle.steps.find((s) => s.id === stepId);
    if (!step) throw new NotFoundException('Admin step not found');

    // [RN-13] Solo el usuario asignado al paso puede completarlo
    if (step.userId !== userId) {
      throw new ForbiddenException('You are not assigned to this admin step');
    }
    if (step.status !== AdminStepStatus.PENDING) {
      throw new ConflictException(`Step status is ${step.status}, cannot complete`);
    }

    const sortedSteps = [...cycle.steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const nextStep    = sortedSteps.find((s) => s.stepOrder > step.stepOrder);
    const isLast      = !nextStep;

    await this.dataSource.transaction(async (manager) => {
      // Guardar nota si viene
      if (dto.notes?.trim()) {
        await manager.save(WorkflowNote, {
          workflowId,
          cycleId,
          adminStepId: stepId,
          createdBy:   userId,
          content:     dto.notes.trim(),
        });
      }

      // Guardar adjuntos si vienen
      if (dto.attachments?.length) {
        const attachments = dto.attachments.map((a) => ({
          workflowId,
          cycleId,
          stepId,
          uploadedBy:    userId,
          documentId:    a.storageKey,
          storageKey:    a.storageKey,
          originalName:  a.originalName,
          mimeType:      a.mimeType,
          fileSizeBytes: a.fileSizeBytes ?? null,
        }));
        await manager.save(WorkflowAdminAttachment, attachments);
      }

      // Completar el paso
      await manager.update(WorkflowAdminStep, stepId, {
        status:      AdminStepStatus.COMPLETED,
        completedAt: new Date(),
      });

      if (isLast) {
        // Último paso — el ciclo se completa
        await manager.update(WorkflowAdminCycle, cycleId, {
          status:           AdminCycleStatus.COMPLETED,
          currentStepOrder: null,
          completedAt:      new Date(),
        });
        // El workflow vuelve al usuario final que inició el ciclo
        await manager.update(Workflow, workflowId, {
          status:                WorkflowStatus.AVAILABLE_FOR_FINAL_USERS,
          activeAdminCycleId:    null,
          currentAssignedUserId: cycle.initiatedBy,
        });
      } else {
        // Activar siguiente paso
        await manager.update(WorkflowAdminStep, nextStep!.id, {
          status: AdminStepStatus.PENDING,
        });
        await manager.update(WorkflowAdminCycle, cycleId, {
          currentStepOrder: nextStep!.stepOrder,
        });
        await manager.update(Workflow, workflowId, {
          currentAssignedUserId: nextStep!.userId,
        });
      }

      await this.timelineService.record({
        workflowId,
        orgId:        workflow.orgId,
        eventType:    TimelineEventType.ADMIN_STEP_COMPLETED,
        actorId:      userId,
        targetUserId: isLast ? cycle.initiatedBy : (nextStep?.userId ?? null),
        resourceName: workflow.title,
        description:  isLast
          ? `Último paso administrativo completado. Ciclo #${cycle.cycleNumber} finalizado. Workflow devuelto al usuario final.`
          : `Paso administrativo ${step.stepOrder} completado. Siguiente: paso ${nextStep!.stepOrder}.`,
        metadata: {
          cycleId,
          stepId,
          stepOrder:      step.stepOrder,
          hasNotes:       !!dto.notes,
          hasAttachments: (dto.attachments?.length ?? 0) > 0,
          isLastStep:     isLast,
        },
      }, manager);

      if (isLast) {
        await this.timelineService.record({
          workflowId,
          orgId:        workflow.orgId,
          eventType:    TimelineEventType.ADMIN_CYCLE_COMPLETED,
          actorId:      userId,
          targetUserId: cycle.initiatedBy,
          resourceName: workflow.title,
          description:  `Ciclo administrativo #${cycle.cycleNumber} completado. Workflow disponible para el usuario final.`,
          metadata:     { cycleId, cycleNumber: cycle.cycleNumber },
        }, manager);
      }
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_ADMIN_CYCLE_STEP_COMPLETED, {
      workflowId,
      cycleId,
      stepId,
      completedBy:    userId,
      nextUserId:     isLast ? null : nextStep?.userId,
      hasNotes:       !!dto.notes,
      hasAttachments: (dto.attachments?.length ?? 0) > 0,
      timestamp:      new Date().toISOString(),
    });

    if (isLast) {
      this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_ADMIN_CYCLE_COMPLETED, {
        workflowId,
        cycleId,
        cycleNumber: cycle.cycleNumber,
        returnedTo:  cycle.initiatedBy,
        timestamp:   new Date().toISOString(),
      });

      this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
        type:             'ADMIN_CYCLE_COMPLETED',
        recipientUserIds: [cycle.initiatedBy],
        orgId:            workflow.orgId,
        workflowId,
        workflowTitle:    workflow.title,
        message:          `El ciclo administrativo #${cycle.cycleNumber} del workflow "${workflow.title}" ha finalizado.`,
        timestamp:        new Date().toISOString(),
      });
    } else {
      this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
        type:             'ADMIN_CYCLE_TASK',
        recipientUserIds: [nextStep!.userId],
        orgId:            workflow.orgId,
        workflowId,
        workflowTitle:    workflow.title,
        message:          `Tienes una tarea pendiente en el ciclo administrativo del workflow "${workflow.title}"`,
        metadata:         { cycleId, stepOrder: nextStep!.stepOrder },
        timestamp:        new Date().toISOString(),
      });
    }

    return this.stepRepo.findOneOrFail({ where: { id: stepId } });
  }

  // ── Reenviar paso a revisor opcional ──────────────────────────────────────────

  /**
   * Un revisor obligatorio (mandatory) reenvía su paso a un revisor opcional
   * del pool definido al crear el ciclo.
   *
   * Flujo:
   *   1. Valida que el paso activo le pertenece al usuario y está PENDING.
   *   2. Valida que el optionalReviewerId está en allowedOptionalReviewerIds del ciclo.
   *   3. Incrementa el stepOrder de todos los pasos posteriores en +1.
   *   4. Inserta un nuevo paso opcional con stepOrder = currentStep.stepOrder + 1.
   *   5. Marca el paso actual como COMPLETED (forwarded).
   *   6. Pone el nuevo paso en PENDING y actualiza cycle.currentStepOrder.
   */
  async forwardStep(
    workflowId: string,
    cycleId: string,
    stepId: string,
    userId: string,
    dto: ForwardAdminStepDto,
  ): Promise<WorkflowAdminStep> {
    const workflow = await this.workflowRepo.findOneOrFail({ where: { id: workflowId } });

    if (workflow.status !== WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS) {
      throw new ConflictException(`Cannot forward step: workflow status is ${workflow.status}`);
    }

    const cycle = await this.cycleRepo.findOne({
      where: { id: cycleId, workflowId },
      relations: ['steps'],
    });
    if (!cycle) throw new NotFoundException('Admin cycle not found');
    if (cycle.status !== AdminCycleStatus.IN_PROGRESS) {
      throw new ConflictException('Admin cycle is not in progress');
    }

    const step = cycle.steps.find((s) => s.id === stepId);
    if (!step) throw new NotFoundException('Admin step not found');

    if (step.userId !== userId) {
      throw new ForbiddenException('You are not assigned to this admin step');
    }
    if (step.status !== AdminStepStatus.PENDING) {
      throw new ConflictException(`Step status is ${step.status}, cannot forward`);
    }
    if (step.isOptional) {
      throw new BadRequestException('Optional reviewer steps cannot forward to another optional reviewer');
    }

    const allowedIds = cycle.allowedOptionalReviewerIds ?? [];
    if (!allowedIds.includes(dto.optionalReviewerId)) {
      throw new BadRequestException(
        `User ${dto.optionalReviewerId} is not in the allowed optional reviewers list`,
      );
    }

    let insertedStep!: WorkflowAdminStep;

    await this.dataSource.transaction(async (manager) => {
      // Guardar nota si viene
      if (dto.notes?.trim()) {
        await manager.save(WorkflowNote, {
          workflowId,
          cycleId,
          adminStepId: stepId,
          createdBy:   userId,
          content:     dto.notes.trim(),
        });
      }

      // Guardar adjuntos si vienen
      if (dto.attachments?.length) {
        const attachments = dto.attachments.map((a) => ({
          workflowId,
          cycleId,
          stepId,
          uploadedBy:    userId,
          documentId:    a.storageKey,
          storageKey:    a.storageKey,
          originalName:  a.originalName,
          mimeType:      a.mimeType,
          fileSizeBytes: a.fileSizeBytes ?? null,
        }));
        await manager.save(WorkflowAdminAttachment, attachments);
      }

      const insertOrder = step.stepOrder + 1;

      // Desplazar todos los pasos con stepOrder >= insertOrder en +1
      // Usamos query builder para actualizar en bulk (evita violación de unique constraint)
      await manager
        .createQueryBuilder()
        .update(WorkflowAdminStep)
        .set({ stepOrder: () => '"step_order" + 1' })
        .where('cycle_id = :cycleId AND step_order >= :insertOrder', { cycleId, insertOrder })
        .execute();

      // Insertar el nuevo paso opcional
      insertedStep = await manager.save(WorkflowAdminStep, {
        cycleId,
        workflowId,
        userId:            dto.optionalReviewerId,
        stepOrder:         insertOrder,
        status:            AdminStepStatus.PENDING,
        isOptional:        true,
        insertedByStepId:  stepId,
      });

      // Completar el paso actual
      await manager.update(WorkflowAdminStep, stepId, {
        status:      AdminStepStatus.COMPLETED,
        completedAt: new Date(),
      });

      // Actualizar ciclo y workflow
      await manager.update(WorkflowAdminCycle, cycleId, {
        currentStepOrder: insertOrder,
      });
      await manager.update(Workflow, workflowId, {
        currentAssignedUserId: dto.optionalReviewerId,
      });

      await this.timelineService.record({
        workflowId,
        orgId:        workflow.orgId,
        eventType:    TimelineEventType.ADMIN_STEP_COMPLETED,
        actorId:      userId,
        targetUserId: dto.optionalReviewerId,
        resourceName: workflow.title,
        description:  `Paso administrativo ${step.stepOrder} reenviado a revisor opcional (usuario ${dto.optionalReviewerId}).`,
        metadata: {
          cycleId,
          stepId,
          stepOrder:         step.stepOrder,
          optionalReviewerId: dto.optionalReviewerId,
          insertedStepId:    insertedStep.id,
          hasNotes:          !!dto.notes,
          hasAttachments:    (dto.attachments?.length ?? 0) > 0,
        },
      }, manager);
    });

    this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
      type:             'ADMIN_CYCLE_TASK',
      recipientUserIds: [dto.optionalReviewerId],
      orgId:            workflow.orgId,
      workflowId,
      workflowTitle:    workflow.title,
      message:          `Has sido invitado como revisor opcional en el ciclo administrativo del workflow "${workflow.title}"`,
      metadata:         { cycleId, stepOrder: step.stepOrder + 1 },
      timestamp:        new Date().toISOString(),
    });

    return this.stepRepo.findOneOrFail({ where: { id: insertedStep.id } });
  }

  // ── Omitir ciclo de revisión ──────────────────────────────────────────────────

  async skipReviewCycle(workflowId: string, userId: string): Promise<Workflow> {
    const workflow = await this.workflowRepo.findOneOrFail({ where: { id: workflowId } });

    if (workflow.status !== WorkflowStatus.PENDING_REVIEW_CYCLE) {
      throw new ConflictException(`Cannot skip review cycle: workflow status is ${workflow.status}`);
    }

    const finalUserIds = workflow.finalUserIds ?? [];
    if (!finalUserIds.includes(userId)) {
      throw new ForbiddenException('Only designated final users can skip the review cycle');
    }

    await this.workflowRepo.update(workflowId, {
      status:                WorkflowStatus.AVAILABLE_FOR_FINAL_USERS,
      currentAssignedUserId: userId,
    });

    await this.timelineService.record({
      workflowId,
      orgId:        workflow.orgId,
      eventType:    TimelineEventType.WORKFLOW_APPROVED,
      actorId:      userId,
      resourceName: workflow.title,
      description:  `Ciclo de revisión omitido. Workflow marcado como disponible directamente.`,
      metadata:     { skippedBy: userId },
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_AVAILABLE_FOR_FINAL_USERS, {
      workflowId,
      orgId:       workflow.orgId,
      finalUserIds,
      timestamp:   new Date().toISOString(),
    });

    return this.workflowRepo.findOneOrFail({ where: { id: workflowId } });
  }

  // ── Finalizar ciclo (alias visual — el ciclo se completa en el último step) ───

  async finalizeCycle(
    workflowId: string,
    cycleId: string,
    userId: string,
  ): Promise<WorkflowAdminCycle> {
    const cycle = await this.cycleRepo.findOneOrFail({
      where: { id: cycleId, workflowId },
      relations: ['steps'],
    });

    // Este endpoint es un "confirm finalize" — el ciclo ya debe estar COMPLETED
    if (cycle.status !== AdminCycleStatus.COMPLETED) {
      throw new ConflictException(
        'Cycle is not yet completed. Complete all steps before finalizing.',
      );
    }

    // Verificar que quien confirma es el que inició el ciclo
    if (cycle.initiatedBy !== userId) {
      throw new ForbiddenException('Only the cycle initiator can finalize');
    }

    return cycle;
  }

  // ── Cerrar workflow ───────────────────────────────────────────────────────────

  async closeWorkflow(
    workflowId: string,
    userId: string,
    dto: CloseWorkflowDto,
  ): Promise<Workflow> {
    const workflow = await this.workflowRepo.findOneOrFail({ where: { id: workflowId } });

    // [RN-14] Solo AVAILABLE_FOR_FINAL_USERS puede cerrarse; ADMIN_CYCLE_IN_PROGRESS y otros estados fallan aquí
    assertValidTransition(workflow.status, WorkflowStatus.CLOSED);

    // [RN-16] Solo usuarios finales pueden cerrar
    const finalUserIds = workflow.finalUserIds ?? [];
    if (!finalUserIds.includes(userId)) {
      throw new ForbiddenException('Only designated final users can close this workflow');
    }

    await this.dataSource.transaction(async (manager) => {
      if (dto.closingNotes?.trim()) {
        await manager.save(WorkflowNote, {
          workflowId,
          createdBy: userId,
          content:   dto.closingNotes.trim(),
        });
      }

      await manager.update(Workflow, workflowId, {
        status:                WorkflowStatus.CLOSED,
        closedBy:              userId,
        closedAt:              new Date(),
        currentAssignedUserId: workflow.createdBy, // llega al creador original para visualización
        activeAdminCycleId:    null,
      });

      await this.timelineService.record({
        workflowId,
        orgId:        workflow.orgId,
        eventType:    TimelineEventType.WORKFLOW_CLOSED,
        actorId:      userId,
        targetUserId: workflow.createdBy,
        resourceName: workflow.title,
        description:  `Workflow cerrado definitivamente por usuario final. No se permiten más modificaciones.`,
        metadata:     { closingNotes: dto.closingNotes ?? null, closedBy: userId },
      }, manager);
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_CLOSED, {
      workflowId,
      orgId:         workflow.orgId,
      closedBy:      userId,
      notifyCreator: workflow.createdBy,
      timestamp:     new Date().toISOString(),
    });

    this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
      type:             'WORKFLOW_CLOSED',
      recipientUserIds: [workflow.createdBy],
      orgId:            workflow.orgId,
      workflowId,
      workflowTitle:    workflow.title,
      message:          `El workflow "${workflow.title}" ha sido cerrado definitivamente.`,
      timestamp:        new Date().toISOString(),
    });

    return this.workflowRepo.findOneOrFail({ where: { id: workflowId } });
  }
}

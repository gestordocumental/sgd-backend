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
import { WorkflowAttachment } from './entities/workflow-attachment.entity';
import { WorkflowNote } from './entities/workflow-note.entity';
import {
  WorkflowStatus,
  AdminCycleStatus,
  AdminStepStatus,
  AttachmentType,
  TimelineEventType,
} from './entities/enums';
import { CreateAdminCycleDto } from './dto/create-admin-cycle.dto';
import { CompleteAdminStepDto } from './dto/complete-admin-step.dto';
import { ForwardAdminStepDto } from './dto/forward-admin-step.dto';
import { CloseWorkflowDto } from './dto/close-workflow.dto';
import { CancelWorkflowDto } from './dto/cancel-workflow.dto';
import { AddWorkflowNoteDto } from './dto/add-workflow-note.dto';
import { WorkflowTimelineService } from './workflow-timeline.service';
import { KafkaProducerService, TOPICS, AppLogger } from '@sgd/common';
import { DocumentClientService } from '../common/clients/document-client.service';

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
    private readonly documentClientService: DocumentClientService,
    private readonly logger: AppLogger,
  ) {}

  // ── Crear ciclo administrativo ────────────────────────────────────────────────

  async createCycle(
    workflowId: string,
    userId: string,
    orgId: string,
    dto: CreateAdminCycleDto,
  ): Promise<WorkflowAdminCycle> {
    // [RN-17] Defensa en profundidad: el ciclo de revisión debe estar habilitado
    // para la tipología de este workflow. El frontend ya oculta el botón cuando
    // está deshabilitado, y approve() ya evita llegar a PENDING_REVIEW_CYCLE en
    // ese caso — esto solo cubre una llamada directa al endpoint. Es una llamada
    // externa así que se hace antes de abrir la transacción para no retener el
    // lock de fila durante un round-trip de red — de ahí esta lectura preliminar
    // sin lock, solo para conocer la tipología. Si el workflow no existe, la
    // lectura con lock dentro de la transacción abajo lo reportará como tal.
    //
    // Riesgo residual aceptado (TOCTOU): entre esta consulta en vivo y el commit
    // de la transacción de más abajo solo corre validación síncrona en memoria
    // (sin I/O), así que la ventana ya es del orden de microsegundos — no hay
    // margen real para acortarla sin violar la convención de este codebase de
    // no hacer llamadas HTTP dentro de una transacción de DB (ver comentarios
    // equivalentes en workflow-approval.service.ts y workflows.service.ts).
    // Cerrarla del todo requeriría un contrato de consistencia atómica entre
    // el Postgres de workflow-service y el MongoDB de document-service
    // (versionado optimista o saga) — cambio de arquitectura cross-servicio,
    // desproporcionado frente al impacto real: en el peor caso se crea un
    // ciclo administrativo para una tipología deshabilitada en el instante
    // exacto de esta llamada, recuperable manualmente y sin implicaciones de
    // seguridad o integridad de datos. Se acepta este riesgo residual.
    const preliminaryWorkflow = await this.workflowRepo.findOne({
      where: { id: workflowId, orgId },
      select: ['typologyId'],
    });
    // Solo llega aquí como `true` — el `false` lanza abajo — así que sirve de
    // paso para refrescar la instantánea desactualizada más adelante, ya que
    // el costo de la llamada en vivo ya se pagó.
    let liveReviewCycleEnabled: true | undefined;
    if (preliminaryWorkflow) {
      const reviewCycleEnabled = await this.documentClientService.isReviewCycleEnabledForTypology(
        orgId,
        preliminaryWorkflow.typologyId,
      );
      if (!reviewCycleEnabled) {
        throw new ForbiddenException('The review cycle is disabled for this typology');
      }
      liveReviewCycleEnabled = true;
    }

    // Validar que los stepOrders sean únicos y consecutivos
    const orders = dto.steps.map((s) => s.stepOrder).sort((a, b) => a - b);
    const hasGap = orders.some((o, i) => i > 0 && o !== orders[i - 1] + 1);
    if (hasGap || orders[0] !== 1) {
      throw new BadRequestException('Step orders must be consecutive starting from 1');
    }
    const hasDuplicates = new Set(orders).size !== orders.length;
    if (hasDuplicates) throw new BadRequestException('Duplicate stepOrder values are not allowed');

    const sorted = [...dto.steps].sort((a, b) => a.stepOrder - b.stepOrder);
    const firstStep = sorted[0];

    let savedCycle!: WorkflowAdminCycle;
    let workflowOrgId!: string;
    let workflowTitle!: string;
    let cycleNumber!: number;

    this.logger.log(
      `createCycle workflowId=${workflowId} steps=${dto.steps.length} ` +
      `allowedOptionalReviewerIds=${JSON.stringify(dto.allowedOptionalReviewerIds ?? [])}`,
    );

    await this.dataSource.transaction(async (manager) => {
      // Lock the workflow row so a concurrent close/cycle-start can't slip
      // in between this check and the writes below — without this, two
      // concurrent requests could both read no-active-cycle and each start
      // one, or one could close the workflow while this cycle is created.
      const workflow = await manager.findOne(Workflow, {
        where: { id: workflowId, orgId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!workflow) throw new NotFoundException('Workflow not found');

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

      workflowOrgId = workflow.orgId;
      workflowTitle = workflow.title;

      // Calcular número de ciclo
      const lastCycle = await manager.findOne(WorkflowAdminCycle, {
        where: { workflowId },
        order: { cycleNumber: 'DESC' },
      });
      cycleNumber = (lastCycle?.cycleNumber ?? 0) + 1;

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
        ...(liveReviewCycleEnabled !== undefined && { reviewCycleEnabled: liveReviewCycleEnabled }),
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
      orgId:            workflowOrgId,
      workflowId,
      workflowTitle:    workflowTitle,
      message:          `Tienes una tarea en el ciclo administrativo del workflow "${workflowTitle}"`,
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
    orgId: string,
    dto: CompleteAdminStepDto,
  ): Promise<WorkflowAdminStep> {
    let workflowOrgId!: string;
    let workflowTitle!: string;
    let cycleInitiatedBy!: string;
    let cycleNumber!: number;
    let nextStepUserId: string | null = null;
    let nextStepOrder: number | undefined;
    let isLast!: boolean;

    await this.dataSource.transaction(async (manager) => {
      // Lock the workflow row so a concurrent close/forward can't change its
      // status between this check and the writes below — without this, both
      // transactions could read a consistent-looking state and commit,
      // completing a step on a workflow whose admin cycle just moved on.
      const workflow = await manager.findOne(Workflow, {
        where: { id: workflowId, orgId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!workflow) throw new NotFoundException('Workflow not found');

      assertValidTransition(workflow.status, WorkflowStatus.AVAILABLE_FOR_FINAL_USERS);

      const cycle = await manager.findOne(WorkflowAdminCycle, {
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
      isLast = !nextStep;

      workflowOrgId    = workflow.orgId;
      workflowTitle    = workflow.title;
      cycleInitiatedBy = cycle.initiatedBy;
      cycleNumber      = cycle.cycleNumber;
      nextStepUserId   = nextStep?.userId ?? null;
      nextStepOrder    = nextStep?.stepOrder;

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
      nextUserId:     isLast ? null : nextStepUserId,
      hasNotes:       !!dto.notes,
      hasAttachments: (dto.attachments?.length ?? 0) > 0,
      timestamp:      new Date().toISOString(),
    });

    if (isLast) {
      this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_ADMIN_CYCLE_COMPLETED, {
        workflowId,
        cycleId,
        cycleNumber,
        returnedTo:  cycleInitiatedBy,
        timestamp:   new Date().toISOString(),
      });

      this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
        type:             'ADMIN_CYCLE_COMPLETED',
        recipientUserIds: [cycleInitiatedBy],
        orgId:            workflowOrgId,
        workflowId,
        workflowTitle:    workflowTitle,
        message:          `El ciclo administrativo #${cycleNumber} del workflow "${workflowTitle}" ha finalizado.`,
        timestamp:        new Date().toISOString(),
      });
    } else {
      this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
        type:             'ADMIN_CYCLE_TASK',
        recipientUserIds: [nextStepUserId!],
        orgId:            workflowOrgId,
        workflowId,
        workflowTitle:    workflowTitle,
        message:          `Tienes una tarea pendiente en el ciclo administrativo del workflow "${workflowTitle}"`,
        metadata:         { cycleId, stepOrder: nextStepOrder },
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
    orgId: string,
    dto: ForwardAdminStepDto,
  ): Promise<WorkflowAdminStep> {
    let insertedStep!: WorkflowAdminStep;
    let workflowOrgId!: string;
    let workflowTitle!: string;
    let stepOrder!: number;

    await this.dataSource.transaction(async (manager) => {
      // Lock the workflow row so a concurrent close/complete can't change
      // its status between this check and the writes below — without this,
      // both transactions could read ADMIN_CYCLE_IN_PROGRESS and commit,
      // forwarding a step on a cycle that already finished.
      const workflow = await manager.findOne(Workflow, {
        where: { id: workflowId, orgId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!workflow) throw new NotFoundException('Workflow not found');

      if (workflow.status !== WorkflowStatus.ADMIN_CYCLE_IN_PROGRESS) {
        throw new ConflictException(`Cannot forward step: workflow status is ${workflow.status}`);
      }

      const cycle = await manager.findOne(WorkflowAdminCycle, {
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

      workflowOrgId = workflow.orgId;
      workflowTitle = workflow.title;
      stepOrder     = step.stepOrder;

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
      orgId:            workflowOrgId,
      workflowId,
      workflowTitle:    workflowTitle,
      message:          `Has sido invitado como revisor opcional en el ciclo administrativo del workflow "${workflowTitle}"`,
      metadata:         { cycleId, stepOrder: stepOrder + 1 },
      timestamp:        new Date().toISOString(),
    });

    return this.stepRepo.findOneOrFail({ where: { id: insertedStep.id } });
  }

  // ── Omitir ciclo de revisión ──────────────────────────────────────────────────

  async skipReviewCycle(workflowId: string, userId: string, orgId: string): Promise<Workflow> {
    let workflowOrgId!: string;
    let finalUserIds: string[] = [];

    await this.dataSource.transaction(async (manager) => {
      // Lock the workflow row so a concurrent admin-cycle-start can't change
      // its status between this check and the update below — without this,
      // createCycle could move the workflow to ADMIN_CYCLE_IN_PROGRESS with
      // an active cycle, and this unconditional update would overwrite that
      // back to AVAILABLE_FOR_FINAL_USERS, orphaning the cycle it just started.
      const workflow = await manager.findOne(Workflow, {
        where: { id: workflowId, orgId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!workflow) throw new NotFoundException('Workflow not found');

      if (workflow.status !== WorkflowStatus.PENDING_REVIEW_CYCLE) {
        throw new ConflictException(`Cannot skip review cycle: workflow status is ${workflow.status}`);
      }

      finalUserIds = workflow.finalUserIds ?? [];
      if (!finalUserIds.includes(userId)) {
        throw new ForbiddenException('Only designated final users can skip the review cycle');
      }

      workflowOrgId = workflow.orgId;

      await manager.update(Workflow, workflowId, {
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
      }, manager);
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_AVAILABLE_FOR_FINAL_USERS, {
      workflowId,
      orgId:       workflowOrgId,
      finalUserIds,
      timestamp:   new Date().toISOString(),
    });

    return this.workflowRepo.findOneOrFail({ where: { id: workflowId, orgId } });
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

  // ── Gestionar: comentario/adjuntos repetibles sin ciclo administrativo ────────

  /**
   * El usuario final deja un comentario y/o adjuntos en el workflow mientras
   * está AVAILABLE_FOR_FINAL_USERS, sin iniciar un ciclo administrativo
   * formal con revisores. A diferencia de un ciclo, esto puede llamarse
   * cuantas veces se quiera antes de que el usuario final decida cerrar el
   * workflow (closeWorkflow) o iniciar un ciclo real.
   */
  async addNote(
    workflowId: string,
    userId: string,
    orgId: string,
    dto: AddWorkflowNoteDto,
  ): Promise<Workflow> {
    const content = dto.content?.trim() || undefined;
    const attachmentCount = dto.attachments?.length ?? 0;
    if (!content && attachmentCount === 0) {
      throw new BadRequestException('Provide at least a comment or an attachment');
    }

    await this.dataSource.transaction(async (manager) => {
      // Lock the workflow row so a concurrent close/admin-cycle-start can't
      // change its status between this check and the writes below — without
      // this, both transactions could read AVAILABLE_FOR_FINAL_USERS and
      // commit, leaving a note attached to a workflow that's already closed.
      const workflow = await manager.findOne(Workflow, {
        where: { id: workflowId, orgId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!workflow) throw new NotFoundException('Workflow not found');

      if (workflow.status !== WorkflowStatus.AVAILABLE_FOR_FINAL_USERS) {
        throw new ConflictException(`Cannot add a note: workflow status is ${workflow.status}`);
      }

      const finalUserIds = workflow.finalUserIds ?? [];
      if (!finalUserIds.includes(userId)) {
        throw new ForbiddenException('Only designated final users can manage this workflow');
      }

      let noteId: string | null = null;
      if (content) {
        const note = await manager.save(WorkflowNote, {
          workflowId,
          createdBy: userId,
          content,
        });
        noteId = note.id;
      }

      if (dto.attachments?.length) {
        const attachments = dto.attachments.map((a) => ({
          workflowId,
          uploadedBy:     userId,
          documentId:     a.storageKey,
          storageKey:     a.storageKey,
          originalName:   a.originalName,
          mimeType:       a.mimeType,
          fileSizeBytes:  a.fileSizeBytes ?? null,
          attachmentType: AttachmentType.MANAGEMENT,
          noteId,
        }));
        await manager.save(WorkflowAttachment, attachments);
      }

      await this.timelineService.record({
        workflowId,
        orgId:        workflow.orgId,
        eventType:    content ? TimelineEventType.NOTE_ADDED : TimelineEventType.ATTACHMENT_ADDED,
        actorId:      userId,
        resourceName: workflow.title,
        description:  content
          ? `Comentario agregado por el usuario final.`
          : `${attachmentCount} adjunto(s) agregado(s) por el usuario final.`,
        metadata: { content: content ?? null, attachmentCount },
      }, manager);
    });

    return this.workflowRepo.findOneOrFail({ where: { id: workflowId, orgId } });
  }

  // ── Cerrar workflow ───────────────────────────────────────────────────────────

  async closeWorkflow(
    workflowId: string,
    userId: string,
    orgId: string,
    dto: CloseWorkflowDto,
  ): Promise<Workflow> {
    let workflowOrgId!: string;
    let workflowTitle!: string;
    let workflowCreatedBy!: string;

    await this.dataSource.transaction(async (manager) => {
      // Lock the workflow row so a concurrent admin-cycle-start can't change
      // its status between this check and the writes below — without this,
      // both transactions could read AVAILABLE_FOR_FINAL_USERS and commit,
      // closing a workflow that just entered a fresh admin cycle.
      const workflow = await manager.findOne(Workflow, {
        where: { id: workflowId, orgId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!workflow) throw new NotFoundException('Workflow not found');

      // [RN-14] Solo AVAILABLE_FOR_FINAL_USERS puede cerrarse; ADMIN_CYCLE_IN_PROGRESS y otros estados fallan aquí
      assertValidTransition(workflow.status, WorkflowStatus.CLOSED);

      // [RN-16] Solo usuarios finales pueden cerrar
      const finalUserIds = workflow.finalUserIds ?? [];
      if (!finalUserIds.includes(userId)) {
        throw new ForbiddenException('Only designated final users can close this workflow');
      }

      workflowOrgId     = workflow.orgId;
      workflowTitle     = workflow.title;
      workflowCreatedBy = workflow.createdBy;

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
      orgId:         workflowOrgId,
      closedBy:      userId,
      notifyCreator: workflowCreatedBy,
      timestamp:     new Date().toISOString(),
    });

    this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
      type:             'WORKFLOW_CLOSED',
      recipientUserIds: [workflowCreatedBy],
      orgId:            workflowOrgId,
      workflowId,
      workflowTitle:    workflowTitle,
      message:          `El workflow "${workflowTitle}" ha sido cerrado definitivamente.`,
      timestamp:        new Date().toISOString(),
    });

    return this.workflowRepo.findOneOrFail({ where: { id: workflowId, orgId } });
  }

  // ── Cancelar workflow ──────────────────────────────────────────────────────────

  async cancelWorkflow(
    workflowId: string,
    userId: string,
    orgId: string,
    dto: CancelWorkflowDto,
  ): Promise<Workflow> {
    let workflowOrgId!: string;
    let workflowTitle!: string;
    let workflowCreatedBy!: string;

    await this.dataSource.transaction(async (manager) => {
      // Lock the workflow row so a concurrent admin-cycle-start can't change
      // its status between this check and the writes below — without this,
      // both transactions could read AVAILABLE_FOR_FINAL_USERS and commit,
      // cancelling a workflow that just entered a fresh admin cycle.
      const workflow = await manager.findOne(Workflow, {
        where: { id: workflowId, orgId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!workflow) throw new NotFoundException('Workflow not found');

      // Solo AVAILABLE_FOR_FINAL_USERS puede cancelarse; ADMIN_CYCLE_IN_PROGRESS y otros estados fallan aquí
      assertValidTransition(workflow.status, WorkflowStatus.CANCELLED);

      // Solo usuarios finales pueden cancelar
      const finalUserIds = workflow.finalUserIds ?? [];
      if (!finalUserIds.includes(userId)) {
        throw new ForbiddenException('Only designated final users can cancel this workflow');
      }

      workflowOrgId     = workflow.orgId;
      workflowTitle     = workflow.title;
      workflowCreatedBy = workflow.createdBy;

      await manager.save(WorkflowNote, {
        workflowId,
        createdBy: userId,
        content:   dto.reason.trim(),
      });

      await manager.update(Workflow, workflowId, {
        status:                WorkflowStatus.CANCELLED,
        cancelledBy:           userId,
        cancelledAt:           new Date(),
        currentAssignedUserId: workflow.createdBy, // llega al creador original para visualización
        activeAdminCycleId:    null,
      });

      await this.timelineService.record({
        workflowId,
        orgId:        workflow.orgId,
        eventType:    TimelineEventType.WORKFLOW_CANCELLED,
        actorId:      userId,
        targetUserId: workflow.createdBy,
        resourceName: workflow.title,
        description:  `Workflow cancelado por usuario final. No se permiten más modificaciones.`,
        metadata:     { reason: dto.reason, cancelledBy: userId },
      }, manager);
    });

    this.kafkaProducer.emitSafe(TOPICS.WORKFLOW_CANCELLED, {
      workflowId,
      orgId:         workflowOrgId,
      cancelledBy:   userId,
      reason:        dto.reason,
      notifyCreator: workflowCreatedBy,
      timestamp:     new Date().toISOString(),
    });

    this.kafkaProducer.emitSafe(TOPICS.NOTIFICATION_SEND, {
      type:             'WORKFLOW_CANCELLED',
      recipientUserIds: [workflowCreatedBy],
      orgId:            workflowOrgId,
      workflowId,
      workflowTitle:    workflowTitle,
      message:          `El workflow "${workflowTitle}" ha sido cancelado.`,
      timestamp:        new Date().toISOString(),
    });

    return this.workflowRepo.findOneOrFail({ where: { id: workflowId, orgId } });
  }
}

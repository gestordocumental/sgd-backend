import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { WorkflowTimeline } from './entities/workflow-timeline.entity';
import { TimelineEventType } from './entities/enums';
import { KafkaProducerService, AppLogger, TOPICS, correlationStorage } from '@sgd/common';

interface RecordEventParams {
  workflowId: string;
  orgId: string;
  eventType: TimelineEventType;
  actorId: string;
  targetUserId?: string | null;
  description: string;
  resourceName?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class WorkflowTimelineService {
  constructor(
    @InjectRepository(WorkflowTimeline)
    private readonly timelineRepo: Repository<WorkflowTimeline>,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Registra un evento en la timeline local Y lo publica a audit-service via Kafka.
   * Este método debe llamarse dentro de la misma transacción de base de datos que el cambio.
   */
  async record(params: RecordEventParams, manager?: EntityManager): Promise<WorkflowTimeline> {
    const repo = manager ? manager.getRepository(WorkflowTimeline) : this.timelineRepo;

    const event = repo.create({
      workflowId:   params.workflowId,
      eventType:    params.eventType,
      actorId:      params.actorId,
      targetUserId: params.targetUserId ?? null,
      description:  params.description,
      metadata:     params.metadata ?? null,
    });

    const saved = await repo.save(event);

    // Publicar a audit-service de forma asíncrona — no bloquea la operación principal
    this.emitAuditLog(params).catch((err: unknown) => {
      this.logger.error(
        `Failed to emit audit.log for workflowId=${params.workflowId} event=${params.eventType}`,
        err instanceof Error ? err.stack : String(err),
        'WorkflowTimelineService',
      );
    });

    return saved;
  }

  async getTimeline(workflowId: string): Promise<WorkflowTimeline[]> {
    return this.timelineRepo.find({
      where: { workflowId },
      order: { createdAt: 'ASC' },
    });
  }

  private async emitAuditLog(params: RecordEventParams): Promise<void> {
    this.kafkaProducer.emitSafe(TOPICS.AUDIT_LOG, {
      service:       'workflow-service',
      actorId:       params.actorId,
      orgId:         params.orgId,
      action:        params.eventType,
      resourceType:  'workflow',
      resourceId:    params.workflowId,
      resourceName:  params.resourceName ?? null,
      correlationId: params.workflowId,   // ID de negocio: agrupa toda la trazabilidad del workflow
      ip:            (correlationStorage.getStore()?.['clientIp'] as string | null) ?? null,
      metadata:      params.metadata ?? null,
      timestamp:     new Date().toISOString(),
    });
  }
}

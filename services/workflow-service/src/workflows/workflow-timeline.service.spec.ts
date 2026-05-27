import { WorkflowTimelineService } from './workflow-timeline.service';
import { WorkflowTimeline } from './entities/workflow-timeline.entity';
import { TimelineEventType } from './entities/enums';
import { Repository, EntityManager } from 'typeorm';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';
import { AppLogger } from '../common/logger/app-logger.service';

function makeRepo(saved: Partial<WorkflowTimeline> = {}): jest.Mocked<Repository<WorkflowTimeline>> {
  const entity = { id: 'tl-1', ...saved } as WorkflowTimeline;
  return {
    create: jest.fn().mockReturnValue(entity),
    save: jest.fn().mockResolvedValue(entity),
    find: jest.fn().mockResolvedValue([entity]),
  } as unknown as jest.Mocked<Repository<WorkflowTimeline>>;
}

function makeKafka(): jest.Mocked<KafkaProducerService> {
  return { emitSafe: jest.fn() } as unknown as jest.Mocked<KafkaProducerService>;
}

function makeLogger(): jest.Mocked<AppLogger> {
  return { error: jest.fn(), warn: jest.fn(), log: jest.fn() } as unknown as jest.Mocked<AppLogger>;
}

const BASE_PARAMS = {
  workflowId: 'wf-1',
  orgId: 'org-1',
  eventType: TimelineEventType.WORKFLOW_CREATED,
  actorId: 'user-1',
  description: 'Test event',
};

describe('WorkflowTimelineService', () => {
  let service: WorkflowTimelineService;
  let repo: jest.Mocked<Repository<WorkflowTimeline>>;
  let kafka: jest.Mocked<KafkaProducerService>;
  let logger: jest.Mocked<AppLogger>;

  beforeEach(() => {
    repo = makeRepo();
    kafka = makeKafka();
    logger = makeLogger();
    service = new WorkflowTimelineService(repo, kafka, logger);
  });

  describe('record()', () => {
    it('creates and saves a timeline event using the injected repo', async () => {
      const result = await service.record(BASE_PARAMS);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowId: 'wf-1',
          eventType: TimelineEventType.WORKFLOW_CREATED,
          actorId: 'user-1',
        }),
      );
      expect(repo.save).toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'tl-1' });
    });

    it('uses manager.getRepository when manager is provided', async () => {
      const managerEntity = { id: 'tl-manager' } as WorkflowTimeline;
      const managerRepo = {
        create: jest.fn().mockReturnValue(managerEntity),
        save: jest.fn().mockResolvedValue(managerEntity),
      };
      const manager = {
        getRepository: jest.fn().mockReturnValue(managerRepo),
      } as unknown as EntityManager;

      const result = await service.record(BASE_PARAMS, manager);

      expect(manager.getRepository).toHaveBeenCalledWith(WorkflowTimeline);
      expect(managerRepo.save).toHaveBeenCalled();
      expect(repo.save).not.toHaveBeenCalled();
      expect(result.id).toBe('tl-manager');
    });

    it('sets targetUserId to null when not provided', async () => {
      await service.record(BASE_PARAMS);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetUserId: null }),
      );
    });

    it('passes targetUserId when provided', async () => {
      await service.record({ ...BASE_PARAMS, targetUserId: 'target-user' });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetUserId: 'target-user' }),
      );
    });

    it('sets metadata to null when not provided', async () => {
      await service.record(BASE_PARAMS);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: null }),
      );
    });

    it('passes metadata when provided', async () => {
      const metadata = { key: 'value' };
      await service.record({ ...BASE_PARAMS, metadata });
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ metadata }),
      );
    });

    it('calls emitSafe asynchronously (does not block)', async () => {
      await service.record(BASE_PARAMS);
      // emitSafe is fire-and-forget — it should have been called
      expect(kafka.emitSafe).toHaveBeenCalled();
    });

    it('logs an error but does not throw when kafka.emitSafe rejects', async () => {
      kafka.emitSafe.mockImplementation(() => { throw new Error('Kafka down'); });

      // Should not throw despite Kafka failure
      await expect(service.record(BASE_PARAMS)).resolves.toBeDefined();
      await Promise.resolve();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getTimeline()', () => {
    it('returns timeline events ordered by createdAt ASC', async () => {
      const events = await service.getTimeline('wf-1');

      expect(repo.find).toHaveBeenCalledWith({
        where: { workflowId: 'wf-1' },
        order: { createdAt: 'ASC' },
      });
      expect(events).toHaveLength(1);
    });

    it('returns empty array when no events exist', async () => {
      repo.find.mockResolvedValueOnce([]);
      const events = await service.getTimeline('wf-99');
      expect(events).toEqual([]);
    });
  });
});

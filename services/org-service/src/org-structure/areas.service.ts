import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Area } from './entities/area.entity';
import { Cargo } from './entities/cargo.entity';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { DepartamentosService } from './departamentos.service';
import { KafkaProducerService, TOPICS, correlationStorage } from '@sgd/common';

@Injectable()
export class AreasService {
  constructor(
    @InjectRepository(Area)
    private readonly repo: Repository<Area>,
    // Read-only, count-only access to check for dependent cargos before
    // deleting — injected directly rather than via CargosService, which
    // already depends on this service to validate its own parent chain.
    @InjectRepository(Cargo)
    private readonly cargoRepo: Repository<Cargo>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly departamentosService: DepartamentosService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  private emitAuditLog(params: {
    actorId: string;
    orgId: string;
    action: string;
    resourceId: string;
    resourceName?: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.kafkaProducer.emitSafe(TOPICS.AUDIT_LOG, {
      service:      'org-service',
      actorId:      params.actorId,
      orgId:        params.orgId,
      action:       params.action,
      resourceType: 'area',
      resourceId:   params.resourceId,
      resourceName: params.resourceName ?? null,
      ip:           (correlationStorage.getStore()?.['clientIp'] as string | undefined) ?? null,
      metadata:     params.metadata ?? null,
      timestamp:    new Date().toISOString(),
    });
  }

  async create(orgId: string, departamentoId: string, dto: CreateAreaDto, actorId?: string): Promise<Area> {
    const saved = await this.dataSource.transaction(async (manager) => {
      // Shared lock on the departamento: serializes this insert against
      // DepartamentosService.remove()'s exclusive lock + dependency count on
      // the same row (see DepartamentosService.findOneLocked()), so an area
      // can never be created in the gap after remove() has already counted
      // zero dependents but before its soft-delete commits.
      await this.departamentosService.findOneLocked(manager, orgId, departamentoId);

      const areaRepo = manager.getRepository(Area);
      const existing = await areaRepo.findOne({ where: { departamentoId, name: dto.name } });
      if (existing) {
        throw new ConflictException({
          message: `Area "${dto.name}" already exists in this departamento`,
          errorCode: 'AREA_ALREADY_EXISTS',
          params: { name: dto.name },
        });
      }

      const area = areaRepo.create({
        orgId,
        departamentoId,
        name: dto.name,
        description: dto.description ?? null,
      });
      return areaRepo.save(area);
    });

    // Emitted after the transaction commits (same ordering as remove()) — an
    // event published mid-transaction would reach Kafka even if the commit
    // later failed, and emitSafe doesn't participate in the transaction to
    // roll back with it.
    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'AREA_CREATED', resourceId: saved.id, resourceName: saved.name, metadata: { departamentoId } });
    }
    return saved;
  }

  async findAll(orgId: string, departamentoId: string): Promise<Area[]> {
    await this.departamentosService.findOne(orgId, departamentoId);
    return this.repo.find({ where: { orgId, departamentoId }, order: { name: 'ASC' }, take: 500 });
  }

  findAllByOrg(orgId: string): Promise<Area[]> {
    return this.repo.find({ where: { orgId }, order: { name: 'ASC' }, take: 500 });
  }

  async findOne(orgId: string, departamentoId: string, id: string): Promise<Area> {
    await this.departamentosService.findOne(orgId, departamentoId);
    const area = await this.repo.findOne({ where: { id, orgId, departamentoId } });
    if (!area) {
      throw new NotFoundException({ message: `Area ${id} not found`, errorCode: 'AREA_NOT_FOUND', params: { id } });
    }
    return area;
  }

  /**
   * Locks & returns the area row (`SELECT ... FOR SHARE`) using the caller's
   * transaction manager. Meant to be called from CargosService.create()
   * before inserting a cargo under this area — see
   * DepartamentosService.findOneLocked() for the full reasoning; this is the
   * same pairing one level down, against this service's own remove().
   */
  async findOneLocked(manager: EntityManager, orgId: string, departamentoId: string, id: string): Promise<Area> {
    await this.departamentosService.findOne(orgId, departamentoId);
    const area = await manager.getRepository(Area).findOne({
      where: { id, orgId, departamentoId },
      lock: { mode: 'pessimistic_read' },
    });
    if (!area) {
      throw new NotFoundException({ message: `Area ${id} not found`, errorCode: 'AREA_NOT_FOUND', params: { id } });
    }
    return area;
  }

  async update(orgId: string, departamentoId: string, id: string, dto: UpdateAreaDto, actorId?: string): Promise<Area> {
    const area = await this.findOne(orgId, departamentoId, id);

    if (dto.name && dto.name !== area.name) {
      const existing = await this.repo.findOne({ where: { departamentoId, name: dto.name } });
      if (existing) {
        throw new ConflictException({
          message: `Area "${dto.name}" already exists in this departamento`,
          errorCode: 'AREA_ALREADY_EXISTS',
          params: { name: dto.name },
        });
      }
    }

    const before: Record<string, unknown> = {}
    for (const key of Object.keys(dto)) before[key] = (area as unknown as Record<string, unknown>)[key]

    Object.assign(area, {
      ...(dto.name        !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    });
    const saved = await this.repo.save(area);

    if (actorId) {
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const key of Object.keys(dto)) {
        const to = (dto as Record<string, unknown>)[key]
        if (before[key] !== to) changes[key] = { from: before[key], to }
      }
      this.emitAuditLog({ actorId, orgId, action: 'AREA_UPDATED', resourceId: id, resourceName: saved.name, metadata: { changes, departamentoId } });
    }
    return saved;
  }

  async remove(orgId: string, departamentoId: string, id: string, actorId?: string): Promise<void> {
    await this.findOne(orgId, departamentoId, id); // fast 404 without opening a transaction when it plainly doesn't exist

    let removedName = '';
    await this.dataSource.transaction(async (manager) => {
      // Exclusive lock (SELECT ... FOR UPDATE): blocks until any concurrent
      // CargosService.create() holding the shared lock from findOneLocked()
      // above commits or rolls back, and blocks any new one from starting
      // until this transaction is done — see findOneLocked() for the other
      // half of this pairing.
      const area = await manager.getRepository(Area).findOne({
        where: { id, orgId, departamentoId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!area) {
        throw new NotFoundException({ message: `Area ${id} not found`, errorCode: 'AREA_NOT_FOUND', params: { id } });
      }

      // Same reasoning as DepartamentosService.remove(): onDelete: 'RESTRICT'
      // is a DB-level FK constraint that never fires on softRemove()'s UPDATE,
      // so without this check an area with cargos gets silently soft-deleted,
      // orphaning those cargos (still in the DB, but unreachable through the
      // normal nested findOne(orgId, departamentoId, areaId, id) read path).
      const cargosCount = await manager.getRepository(Cargo).count({ where: { areaId: id } });
      if (cargosCount > 0) {
        throw new ConflictException({
          message: `Cannot delete area "${area.name}": it still has ${cargosCount} cargo(s) associated`,
          errorCode: 'AREA_HAS_DEPENDENCIES',
          params: { id, cargosCount },
        });
      }

      await manager.getRepository(Area).softRemove(area);
      removedName = area.name;
    });

    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'AREA_DELETED', resourceId: id, resourceName: removedName, metadata: { departamentoId } });
    }
  }

  async restore(orgId: string, departamentoId: string, id: string, actorId?: string): Promise<Area> {
    await this.departamentosService.findOne(orgId, departamentoId);
    const area = await this.repo.findOne({ where: { id, orgId, departamentoId }, withDeleted: true });
    if (!area) {
      throw new NotFoundException({ message: `Area ${id} not found`, errorCode: 'AREA_NOT_FOUND', params: { id } });
    }
    if (!area.deletedAt) {
      throw new ConflictException({ message: `Area ${id} is not deleted`, errorCode: 'AREA_NOT_DELETED', params: { id } });
    }
    const nameConflict = await this.repo.findOne({ where: { departamentoId, name: area.name } });
    if (nameConflict) {
      throw new ConflictException({
        message: `Area "${area.name}" already exists in this departamento`,
        errorCode: 'AREA_ALREADY_EXISTS',
        params: { name: area.name },
      });
    }
    await this.repo.restore(id);
    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'AREA_RESTORED', resourceId: id, resourceName: area.name, metadata: { departamentoId } });
    }
    return this.findOne(orgId, departamentoId, id);
  }
}

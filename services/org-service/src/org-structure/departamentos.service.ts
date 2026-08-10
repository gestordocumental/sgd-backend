import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Departamento } from './entities/departamento.entity';
import { Area } from './entities/area.entity';
import { Cargo } from './entities/cargo.entity';
import { CreateDepartamentoDto } from './dto/create-departamento.dto';
import { UpdateDepartamentoDto } from './dto/update-departamento.dto';
import { KafkaProducerService, TOPICS, correlationStorage } from '@sgd/common';

@Injectable()
export class DepartamentosService {
  constructor(
    @InjectRepository(Departamento)
    private readonly repo: Repository<Departamento>,
    // Read-only, count-only access to check for dependents before deleting —
    // injected directly (not via AreasService/CargosService) to avoid a
    // circular dependency, since both of those already depend on this
    // service to validate their own parent chain.
    @InjectRepository(Area)
    private readonly areaRepo: Repository<Area>,
    @InjectRepository(Cargo)
    private readonly cargoRepo: Repository<Cargo>,
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
      resourceType: 'departamento',
      resourceId:   params.resourceId,
      resourceName: params.resourceName ?? null,
      ip:           correlationStorage.getStore()?.['clientIp'] as string | null,
      metadata:     params.metadata ?? null,
      timestamp:    new Date().toISOString(),
    });
  }

  async create(orgId: string, dto: CreateDepartamentoDto, actorId?: string): Promise<Departamento> {
    const existing = await this.repo.findOne({ where: { orgId, name: dto.name } });
    if (existing) {
      throw new ConflictException({
        message: `Departamento "${dto.name}" already exists in this organization`,
        errorCode: 'DEPARTMENT_ALREADY_EXISTS',
        params: { name: dto.name },
      });
    }

    const departamento = this.repo.create({
      orgId,
      name: dto.name,
      description: dto.description ?? null,
    });
    const saved = await this.repo.save(departamento);
    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'DEPARTAMENTO_CREATED', resourceId: saved.id, resourceName: saved.name });
    }
    return saved;
  }

  findAll(orgId: string): Promise<Departamento[]> {
    return this.repo.find({ where: { orgId }, order: { name: 'ASC' }, take: 500 });
  }

  async findOne(orgId: string, id: string): Promise<Departamento> {
    const departamento = await this.repo.findOne({ where: { id, orgId } });
    if (!departamento) {
      throw new NotFoundException({
        message: `Departamento ${id} not found`,
        errorCode: 'DEPARTMENT_NOT_FOUND',
        params: { id },
      });
    }
    return departamento;
  }

  async update(orgId: string, id: string, dto: UpdateDepartamentoDto, actorId?: string): Promise<Departamento> {
    const departamento = await this.findOne(orgId, id);

    if (dto.name && dto.name !== departamento.name) {
      const existing = await this.repo.findOne({ where: { orgId, name: dto.name } });
      if (existing) {
        throw new ConflictException({
          message: `Departamento "${dto.name}" already exists in this organization`,
          errorCode: 'DEPARTMENT_ALREADY_EXISTS',
          params: { name: dto.name },
        });
      }
    }

    const before: Record<string, unknown> = {}
    for (const key of Object.keys(dto)) before[key] = (departamento as unknown as Record<string, unknown>)[key]

    Object.assign(departamento, {
      ...(dto.name        !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    });
    const saved = await this.repo.save(departamento);

    if (actorId) {
      const changes: Record<string, { from: unknown; to: unknown }> = {}
      for (const key of Object.keys(dto)) {
        const to = (dto as Record<string, unknown>)[key]
        if (before[key] !== to) changes[key] = { from: before[key], to }
      }
      this.emitAuditLog({ actorId, orgId, action: 'DEPARTAMENTO_UPDATED', resourceId: id, resourceName: saved.name, metadata: { changes } });
    }
    return saved;
  }

  async remove(orgId: string, id: string, actorId?: string): Promise<void> {
    const departamento = await this.findOne(orgId, id);

    // Guards against orphaning areas/cargos: the entities declare onDelete:
    // 'RESTRICT' on this relation, but that's a DB-level FK constraint that
    // only fires on a real SQL DELETE — softRemove() issues an UPDATE
    // (deleted_at = now()), which never trips it. Without this explicit
    // check, deleting a departamento silently orphans its areas and cargos:
    // they still exist but become unreachable, since every read path here
    // resolves the parent departamento with a plain (non-withDeleted)
    // findOne first.
    const [areasCount, cargosCount] = await Promise.all([
      this.areaRepo.count({ where: { departamentoId: id } }),
      // Covers both area-scoped and department-level (areaId: null) cargos —
      // departamentoId is always set on Cargo regardless of areaId.
      this.cargoRepo.count({ where: { departamentoId: id } }),
    ]);
    if (areasCount > 0 || cargosCount > 0) {
      throw new ConflictException({
        message: `Cannot delete departamento "${departamento.name}": it still has ${areasCount} area(s) and ${cargosCount} cargo(s) associated`,
        errorCode: 'DEPARTMENT_HAS_DEPENDENCIES',
        params: { id, areasCount, cargosCount },
      });
    }

    await this.repo.softRemove(departamento);
    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'DEPARTAMENTO_DELETED', resourceId: id, resourceName: departamento.name });
    }
  }

  async restore(orgId: string, id: string, actorId?: string): Promise<Departamento> {
    const departamento = await this.repo.findOne({ where: { id, orgId }, withDeleted: true });
    if (!departamento) {
      throw new NotFoundException({
        message: `Departamento ${id} not found`,
        errorCode: 'DEPARTMENT_NOT_FOUND',
        params: { id },
      });
    }
    if (!departamento.deletedAt) {
      throw new ConflictException({
        message: `Departamento ${id} is not deleted`,
        errorCode: 'DEPARTMENT_NOT_DELETED',
        params: { id },
      });
    }
    const nameConflict = await this.repo.findOne({ where: { orgId, name: departamento.name } });
    if (nameConflict) {
      throw new ConflictException({
        message: `Departamento "${departamento.name}" already exists in this organization`,
        errorCode: 'DEPARTMENT_ALREADY_EXISTS',
        params: { name: departamento.name },
      });
    }
    await this.repo.restore(id);
    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'DEPARTAMENTO_RESTORED', resourceId: id, resourceName: departamento.name });
    }
    return this.findOne(orgId, id);
  }
}

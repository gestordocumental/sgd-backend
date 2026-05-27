import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { Cargo } from './entities/cargo.entity';
import { CreateCargoDto } from './dto/create-cargo.dto';
import { UpdateCargoDto } from './dto/update-cargo.dto';
import { AreasService } from './areas.service';
import { DepartamentosService } from './departamentos.service';
import { KafkaProducerService, TOPICS, correlationStorage } from '@sgd/common';

@Injectable()
export class CargosService {
  constructor(
    @InjectRepository(Cargo)
    private readonly repo: Repository<Cargo>,
    private readonly areasService: AreasService,
    private readonly departamentosService: DepartamentosService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  private emitAuditLog(params: {
    actorId?: string;
    orgId: string;
    action: string;
    resourceId: string;
    resourceName?: string;
    metadata?: Record<string, unknown>;
  }): void {
    if (!params.actorId) return;
    this.kafkaProducer.emitSafe(TOPICS.AUDIT_LOG, {
      service:      'org-service',
      actorId:      params.actorId,
      orgId:        params.orgId,
      action:       params.action,
      resourceType: 'cargo',
      resourceId:   params.resourceId,
      resourceName: params.resourceName ?? null,
      ip:           (correlationStorage.getStore()?.['clientIp'] as string | undefined) ?? null,
      metadata:     params.metadata,
      timestamp:    new Date().toISOString(),
    });
  }

  /**
   * Creates a cargo.
   * - areaId = string  → area-level cargo (validates area exists)
   * - areaId = null    → department-level cargo (no area required)
   */
  async create(
    orgId: string,
    departamentoId: string,
    areaId: string | null,
    dto: CreateCargoDto,
    actorId?: string,
  ): Promise<Cargo> {
    if (areaId) {
      await this.areasService.findOne(orgId, departamentoId, areaId);
      const existing = await this.repo.findOne({ where: { areaId, name: dto.name } });
      if (existing) throw new ConflictException(`Cargo "${dto.name}" already exists in this area`);
    } else {
      await this.departamentosService.findOne(orgId, departamentoId);
      const existing = await this.repo.findOne({
        where: { departamentoId, name: dto.name, areaId: IsNull() },
      });
      if (existing) {
        throw new ConflictException(`Cargo "${dto.name}" already exists in this department`);
      }
    }

    const cargo = this.repo.create({
      orgId,
      areaId:        areaId ?? null,
      departamentoId,
      name:          dto.name,
      description:   dto.description ?? null,
    });
    const saved = await this.repo.save(cargo);
    this.emitAuditLog({
      actorId, orgId, action: 'CARGO_CREATED', resourceId: saved.id,
      resourceName: saved.name, metadata: { areaId, departamentoId },
    });
    return saved;
  }

  async findAll(orgId: string, departamentoId: string, areaId: string): Promise<Cargo[]> {
    await this.areasService.findOne(orgId, departamentoId, areaId);
    return this.repo.find({ where: { orgId, departamentoId, areaId }, order: { name: 'ASC' }, take: 500 });
  }

  /** Cargos at the department level (areaId = null). */
  findByDepartamento(orgId: string, departamentoId: string): Promise<Cargo[]> {
    return this.repo.find({
      where: { orgId, departamentoId, areaId: IsNull() },
      order: { name: 'ASC' },
    });
  }

  findAllByOrg(orgId: string): Promise<Cargo[]> {
    return this.repo.find({ where: { orgId }, order: { name: 'ASC' }, take: 500 });
  }

  async findOne(orgId: string, departamentoId: string, areaId: string, id: string): Promise<Cargo> {
    await this.areasService.findOne(orgId, departamentoId, areaId);
    const cargo = await this.repo.findOne({ where: { id, orgId, departamentoId, areaId } });
    if (!cargo) throw new NotFoundException(`Cargo ${id} not found`);
    return cargo;
  }

  async findOneDept(orgId: string, departamentoId: string, id: string): Promise<Cargo> {
    const cargo = await this.repo.findOne({
      where: { id, orgId, departamentoId, areaId: IsNull() },
    });
    if (!cargo) throw new NotFoundException(`Cargo ${id} not found`);
    return cargo;
  }

  async update(
    orgId: string,
    departamentoId: string,
    areaId: string,
    id: string,
    dto: UpdateCargoDto,
    actorId?: string,
  ): Promise<Cargo> {
    const cargo = await this.findOne(orgId, departamentoId, areaId, id);
    if (dto.name && dto.name !== cargo.name) {
      const existing = await this.repo.findOne({ where: { areaId, name: dto.name } });
      if (existing) throw new ConflictException(`Cargo "${dto.name}" already exists in this area`);
    }
    const before: Record<string, unknown> = {}
    for (const key of Object.keys(dto)) before[key] = (cargo as unknown as Record<string, unknown>)[key]

    Object.assign(cargo, {
      ...(dto.name        !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    });
    const saved = await this.repo.save(cargo);

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of Object.keys(dto)) {
      const to = (dto as Record<string, unknown>)[key]
      if (before[key] !== to) changes[key] = { from: before[key], to }
    }
    this.emitAuditLog({
      actorId, orgId, action: 'CARGO_UPDATED', resourceId: id,
      resourceName: saved.name, metadata: { changes, areaId, departamentoId },
    });
    return saved;
  }

  async updateDept(
    orgId: string,
    departamentoId: string,
    id: string,
    dto: UpdateCargoDto,
    actorId?: string,
  ): Promise<Cargo> {
    const cargo = await this.findOneDept(orgId, departamentoId, id);
    if (dto.name && dto.name !== cargo.name) {
      const existing = await this.repo.findOne({
        where: { departamentoId, name: dto.name, areaId: IsNull() },
      });
      if (existing) {
        throw new ConflictException(`Cargo "${dto.name}" already exists in this department`);
      }
    }

    const before: Record<string, unknown> = {}
    for (const key of Object.keys(dto)) before[key] = (cargo as unknown as Record<string, unknown>)[key]

    Object.assign(cargo, {
      ...(dto.name        !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    });
    const saved = await this.repo.save(cargo);

    const changes: Record<string, { from: unknown; to: unknown }> = {}
    for (const key of Object.keys(dto)) {
      const to = (dto as Record<string, unknown>)[key]
      if (before[key] !== to) changes[key] = { from: before[key], to }
    }
    this.emitAuditLog({
      actorId, orgId, action: 'CARGO_UPDATED', resourceId: id,
      resourceName: saved.name, metadata: { changes, departamentoId },
    });
    return saved;
  }

  async remove(orgId: string, departamentoId: string, areaId: string, id: string, actorId?: string): Promise<void> {
    const cargo = await this.findOne(orgId, departamentoId, areaId, id);
    await this.repo.softRemove(cargo);
    this.emitAuditLog({ actorId, orgId, action: 'CARGO_DELETED', resourceId: id, resourceName: cargo.name, metadata: { areaId, departamentoId } });
  }

  async removeDept(orgId: string, departamentoId: string, id: string, actorId?: string): Promise<void> {
    const cargo = await this.findOneDept(orgId, departamentoId, id);
    await this.repo.softRemove(cargo);
    this.emitAuditLog({ actorId, orgId, action: 'CARGO_DELETED', resourceId: id, resourceName: cargo.name, metadata: { departamentoId } });
  }

  async restore(orgId: string, departamentoId: string, areaId: string, id: string, actorId?: string): Promise<Cargo> {
    await this.areasService.findOne(orgId, departamentoId, areaId);
    const cargo = await this.repo.findOne({ where: { id, orgId, departamentoId, areaId }, withDeleted: true });
    if (!cargo) throw new NotFoundException(`Cargo ${id} not found`);
    if (!cargo.deletedAt) throw new ConflictException(`Cargo ${id} is not deleted`);
    const nameConflict = await this.repo.findOne({ where: { areaId, name: cargo.name } });
    if (nameConflict) throw new ConflictException(`Cargo "${cargo.name}" already exists in this area`);
    await this.repo.restore(id);
    this.emitAuditLog({ actorId, orgId, action: 'CARGO_RESTORED', resourceId: id, resourceName: cargo.name, metadata: { areaId, departamentoId } });
    return this.findOne(orgId, departamentoId, areaId, id);
  }

  async restoreDept(orgId: string, departamentoId: string, id: string, actorId?: string): Promise<Cargo> {
    const cargo = await this.repo.findOne({
      where: { id, orgId, departamentoId, areaId: IsNull() },
      withDeleted: true,
    });
    if (!cargo) throw new NotFoundException(`Cargo ${id} not found`);
    if (!cargo.deletedAt) throw new ConflictException(`Cargo ${id} is not deleted`);
    const nameConflict = await this.repo.findOne({
      where: { departamentoId, name: cargo.name, areaId: IsNull() },
    });
    if (nameConflict) {
      throw new ConflictException(`Cargo "${cargo.name}" already exists in this department`);
    }
    await this.repo.restore(id);
    this.emitAuditLog({ actorId, orgId, action: 'CARGO_RESTORED', resourceId: id, resourceName: cargo.name, metadata: { departamentoId } });
    return this.findOneDept(orgId, departamentoId, id);
  }
}

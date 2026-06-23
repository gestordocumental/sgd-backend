import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Area } from './entities/area.entity';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { DepartamentosService } from './departamentos.service';
import { KafkaProducerService, TOPICS, correlationStorage } from '@sgd/common';

@Injectable()
export class AreasService {
  constructor(
    @InjectRepository(Area)
    private readonly repo: Repository<Area>,
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
    // Validate parent exists in the same org
    await this.departamentosService.findOne(orgId, departamentoId);

    const existing = await this.repo.findOne({ where: { departamentoId, name: dto.name } });
    if (existing) {
      throw new ConflictException(`Area "${dto.name}" already exists in this departamento`);
    }

    const area = this.repo.create({
      orgId,
      departamentoId,
      name: dto.name,
      description: dto.description ?? null,
    });
    const saved = await this.repo.save(area);
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
    if (!area) throw new NotFoundException(`Area ${id} not found`);
    return area;
  }

  async update(orgId: string, departamentoId: string, id: string, dto: UpdateAreaDto, actorId?: string): Promise<Area> {
    const area = await this.findOne(orgId, departamentoId, id);

    if (dto.name && dto.name !== area.name) {
      const existing = await this.repo.findOne({ where: { departamentoId, name: dto.name } });
      if (existing) {
        throw new ConflictException(`Area "${dto.name}" already exists in this departamento`);
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
    const area = await this.findOne(orgId, departamentoId, id);
    await this.repo.softRemove(area);
    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'AREA_DELETED', resourceId: id, resourceName: area.name, metadata: { departamentoId } });
    }
  }

  async restore(orgId: string, departamentoId: string, id: string, actorId?: string): Promise<Area> {
    await this.departamentosService.findOne(orgId, departamentoId);
    const area = await this.repo.findOne({ where: { id, orgId, departamentoId }, withDeleted: true });
    if (!area) throw new NotFoundException(`Area ${id} not found`);
    if (!area.deletedAt) throw new ConflictException(`Area ${id} is not deleted`);
    const nameConflict = await this.repo.findOne({ where: { departamentoId, name: area.name } });
    if (nameConflict) throw new ConflictException(`Area "${area.name}" already exists in this departamento`);
    await this.repo.restore(id);
    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'AREA_RESTORED', resourceId: id, resourceName: area.name, metadata: { departamentoId } });
    }
    return this.findOne(orgId, departamentoId, id);
  }
}

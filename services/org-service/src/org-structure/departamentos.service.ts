import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Departamento } from './entities/departamento.entity';
import { CreateDepartamentoDto } from './dto/create-departamento.dto';
import { UpdateDepartamentoDto } from './dto/update-departamento.dto';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';
import { TOPICS } from '../common/kafka/kafka.constants';
import { getClientIp } from '../common/correlation/correlation.context';

@Injectable()
export class DepartamentosService {
  constructor(
    @InjectRepository(Departamento)
    private readonly repo: Repository<Departamento>,
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
      ip:           getClientIp(),
      metadata:     params.metadata,
      timestamp:    new Date().toISOString(),
    });
  }

  async create(orgId: string, dto: CreateDepartamentoDto, actorId?: string): Promise<Departamento> {
    const existing = await this.repo.findOne({ where: { orgId, name: dto.name } });
    if (existing) {
      throw new ConflictException(`Departamento "${dto.name}" already exists in this organization`);
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
    return this.repo.find({ where: { orgId }, order: { name: 'ASC' } });
  }

  async findOne(orgId: string, id: string): Promise<Departamento> {
    const departamento = await this.repo.findOne({ where: { id, orgId } });
    if (!departamento) throw new NotFoundException(`Departamento ${id} not found`);
    return departamento;
  }

  async update(orgId: string, id: string, dto: UpdateDepartamentoDto, actorId?: string): Promise<Departamento> {
    const departamento = await this.findOne(orgId, id);

    if (dto.name && dto.name !== departamento.name) {
      const existing = await this.repo.findOne({ where: { orgId, name: dto.name } });
      if (existing) {
        throw new ConflictException(`Departamento "${dto.name}" already exists in this organization`);
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
    await this.repo.softRemove(departamento);
    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'DEPARTAMENTO_DELETED', resourceId: id, resourceName: departamento.name });
    }
  }

  async restore(orgId: string, id: string, actorId?: string): Promise<Departamento> {
    const departamento = await this.repo.findOne({ where: { id, orgId }, withDeleted: true });
    if (!departamento) throw new NotFoundException(`Departamento ${id} not found`);
    if (!departamento.deletedAt) throw new ConflictException(`Departamento ${id} is not deleted`);
    const nameConflict = await this.repo.findOne({ where: { orgId, name: departamento.name } });
    if (nameConflict) throw new ConflictException(`Departamento "${departamento.name}" already exists in this organization`);
    await this.repo.restore(id);
    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'DEPARTAMENTO_RESTORED', resourceId: id, resourceName: departamento.name });
    }
    return this.findOne(orgId, id);
  }
}

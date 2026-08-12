import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Cargo } from './entities/cargo.entity';
import { CreateCargoDto } from './dto/create-cargo.dto';
import { UpdateCargoDto } from './dto/update-cargo.dto';
import { AreasService } from './areas.service';
import { DepartamentosService } from './departamentos.service';
import { DocumentClientService } from '../common/document-client/document-client.service';
import { UserClientService } from '../common/user-client/user-client.service';
import { KafkaProducerService, TOPICS, correlationStorage } from '@sgd/common';

@Injectable()
export class CargosService {
  constructor(
    @InjectRepository(Cargo)
    private readonly repo: Repository<Cargo>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly areasService: AreasService,
    private readonly departamentosService: DepartamentosService,
    private readonly documentClient: DocumentClientService,
    private readonly userClient: UserClientService,
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
      metadata:     params.metadata ?? null,
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
    const saved = await this.dataSource.transaction(async (manager) => {
      const cargoRepo = manager.getRepository(Cargo);

      if (areaId) {
        // Shared lock on the area: serializes this insert against
        // AreasService.remove()'s exclusive lock + dependency count on the
        // same row (see AreasService.findOneLocked()), so a cargo can never
        // be created in the gap after remove() has already counted zero
        // dependents but before its soft-delete commits.
        await this.areasService.findOneLocked(manager, orgId, departamentoId, areaId);
        const existing = await cargoRepo.findOne({ where: { areaId, name: dto.name } });
        if (existing) {
          throw new ConflictException({
            message: `Cargo "${dto.name}" already exists in this area`,
            errorCode: 'CARGO_ALREADY_EXISTS_IN_AREA',
            params: { name: dto.name },
          });
        }
      } else {
        // Same reasoning, one level up: department-level cargos race against
        // DepartamentosService.remove() instead of AreasService.remove().
        await this.departamentosService.findOneLocked(manager, orgId, departamentoId);
        const existing = await cargoRepo.findOne({
          where: { departamentoId, name: dto.name, areaId: IsNull() },
        });
        if (existing) {
          throw new ConflictException({
            message: `Cargo "${dto.name}" already exists in this department`,
            errorCode: 'CARGO_ALREADY_EXISTS_IN_DEPARTMENT',
            params: { name: dto.name },
          });
        }
      }

      const cargo = cargoRepo.create({
        orgId,
        areaId:        areaId ?? null,
        departamentoId,
        name:          dto.name,
        description:   dto.description ?? null,
      });
      return cargoRepo.save(cargo);
    });

    // Emitted after the transaction commits (same ordering as remove()) — an
    // event published mid-transaction would reach Kafka even if the commit
    // later failed, and emitSafe doesn't participate in the transaction to
    // roll back with it.
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
    if (!cargo) {
      throw new NotFoundException({ message: `Cargo ${id} not found`, errorCode: 'CARGO_NOT_FOUND', params: { id } });
    }
    return cargo;
  }

  async findOneDept(orgId: string, departamentoId: string, id: string): Promise<Cargo> {
    const cargo = await this.repo.findOne({
      where: { id, orgId, departamentoId, areaId: IsNull() },
    });
    if (!cargo) {
      throw new NotFoundException({ message: `Cargo ${id} not found`, errorCode: 'CARGO_NOT_FOUND', params: { id } });
    }
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
      if (existing) {
        throw new ConflictException({
          message: `Cargo "${dto.name}" already exists in this area`,
          errorCode: 'CARGO_ALREADY_EXISTS_IN_AREA',
          params: { name: dto.name },
        });
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
        throw new ConflictException({
          message: `Cargo "${dto.name}" already exists in this department`,
          errorCode: 'CARGO_ALREADY_EXISTS_IN_DEPARTMENT',
          params: { name: dto.name },
        });
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

  /**
   * Blocks deleting a cargo that a typology or user still references —
   * otherwise their record is left pointing at a cargoId that no longer
   * exists. Deliberately NOT wrapped in try/catch: a failure here (timeout,
   * open circuit, 5xx) must fail the delete too (fail-closed), not silently
   * let it through. DocumentClientService/UserClientService already
   * translate every failure mode into a propagatable Nest exception.
   */
  private async assertNoExternalReferences(orgId: string, cargo: Cargo): Promise<void> {
    const [typologiesCount, usersCount] = await Promise.all([
      this.documentClient.countOrgStructureReferences(orgId, { cargoId: cargo.id }),
      this.userClient.countOrgStructureReferences({ cargoId: cargo.id }),
    ]);
    if (typologiesCount > 0 || usersCount > 0) {
      throw new ConflictException({
        message: `Cannot delete cargo "${cargo.name}": it is still referenced by ${typologiesCount} typology(ies) and ${usersCount} user(s)`,
        errorCode: 'CARGO_HAS_EXTERNAL_REFERENCES',
        params: { id: cargo.id, typologiesCount, usersCount },
      });
    }
  }

  async remove(orgId: string, departamentoId: string, areaId: string, id: string, actorId?: string): Promise<void> {
    const cargo = await this.findOne(orgId, departamentoId, areaId, id);
    await this.assertNoExternalReferences(orgId, cargo);
    await this.repo.softRemove(cargo);
    this.emitAuditLog({ actorId, orgId, action: 'CARGO_DELETED', resourceId: id, resourceName: cargo.name, metadata: { areaId, departamentoId } });
  }

  async removeDept(orgId: string, departamentoId: string, id: string, actorId?: string): Promise<void> {
    const cargo = await this.findOneDept(orgId, departamentoId, id);
    await this.assertNoExternalReferences(orgId, cargo);
    await this.repo.softRemove(cargo);
    this.emitAuditLog({ actorId, orgId, action: 'CARGO_DELETED', resourceId: id, resourceName: cargo.name, metadata: { departamentoId } });
  }

  async restore(orgId: string, departamentoId: string, areaId: string, id: string, actorId?: string): Promise<Cargo> {
    await this.areasService.findOne(orgId, departamentoId, areaId);
    const cargo = await this.repo.findOne({ where: { id, orgId, departamentoId, areaId }, withDeleted: true });
    if (!cargo) {
      throw new NotFoundException({ message: `Cargo ${id} not found`, errorCode: 'CARGO_NOT_FOUND', params: { id } });
    }
    if (!cargo.deletedAt) {
      throw new ConflictException({ message: `Cargo ${id} is not deleted`, errorCode: 'CARGO_NOT_DELETED', params: { id } });
    }
    const nameConflict = await this.repo.findOne({ where: { areaId, name: cargo.name } });
    if (nameConflict) {
      throw new ConflictException({
        message: `Cargo "${cargo.name}" already exists in this area`,
        errorCode: 'CARGO_ALREADY_EXISTS_IN_AREA',
        params: { name: cargo.name },
      });
    }
    await this.repo.restore(id);
    this.emitAuditLog({ actorId, orgId, action: 'CARGO_RESTORED', resourceId: id, resourceName: cargo.name, metadata: { areaId, departamentoId } });
    return this.findOne(orgId, departamentoId, areaId, id);
  }

  async restoreDept(orgId: string, departamentoId: string, id: string, actorId?: string): Promise<Cargo> {
    const cargo = await this.repo.findOne({
      where: { id, orgId, departamentoId, areaId: IsNull() },
      withDeleted: true,
    });
    if (!cargo) {
      throw new NotFoundException({ message: `Cargo ${id} not found`, errorCode: 'CARGO_NOT_FOUND', params: { id } });
    }
    if (!cargo.deletedAt) {
      throw new ConflictException({ message: `Cargo ${id} is not deleted`, errorCode: 'CARGO_NOT_DELETED', params: { id } });
    }
    const nameConflict = await this.repo.findOne({
      where: { departamentoId, name: cargo.name, areaId: IsNull() },
    });
    if (nameConflict) {
      throw new ConflictException({
        message: `Cargo "${cargo.name}" already exists in this department`,
        errorCode: 'CARGO_ALREADY_EXISTS_IN_DEPARTMENT',
        params: { name: cargo.name },
      });
    }
    await this.repo.restore(id);
    this.emitAuditLog({ actorId, orgId, action: 'CARGO_RESTORED', resourceId: id, resourceName: cargo.name, metadata: { departamentoId } });
    return this.findOneDept(orgId, departamentoId, id);
  }
}

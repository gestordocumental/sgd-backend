import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Org, OrgStatus } from './entities/org.entity';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';
import { KafkaProducerService, TOPICS, correlationStorage } from '@sgd/common';
import { UserClientService } from '../common/user-client/user-client.service';

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: createdAt.toISOString(), id })).toString('base64url');
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function decodeCursor(raw: string): { at: string; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (
      typeof parsed.at !== 'string' ||
      Number.isNaN(Date.parse(parsed.at)) ||
      typeof parsed.id !== 'string' ||
      !UUID_RE.test(parsed.id)
    ) {
      throw new BadRequestException('Invalid cursor');
    }
    return parsed;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }
}

@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name);

  constructor(
    @InjectRepository(Org)
    private readonly orgRepo: Repository<Org>,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly userClient: UserClientService,
  ) {}

  private emitAuditLog(
    action: string,
    org: Org,
    actorId: string,
    metadata?: Record<string, unknown>,
  ): void {
    this.kafkaProducer.emitSafe(TOPICS.AUDIT_LOG, {
      service:      'org-service',
      actorId,
      orgId:        null,
      action,
      resourceType: 'company',
      resourceId:   org.id,
      resourceName: org.name,
      ip:           correlationStorage.getStore()?.['clientIp'] as string | null,
      timestamp:    new Date().toISOString(),
      metadata:     metadata ?? null,
    });
  }

  async create(dto: CreateOrgDto, createdBy: string): Promise<Org> {
    const existing = await this.orgRepo.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`Organization with name "${dto.name}" already exists`);
    }

    const org = this.orgRepo.create({
      name:      dto.name,
      nit:       dto.nit       ?? null,
      address:   dto.address   ?? null,
      phone:     dto.phone     ?? null,
      status:    OrgStatus.ACTIVE,
      createdBy,
    });

    const saved = await this.orgRepo.save(org);
    this.emitAuditLog('COMPANY_CREATED', saved, createdBy);
    return saved;
  }

  async findAll(params: {
    limit?: number;
    cursor?: string;
    search?: string;
    status?: 'active' | 'inactive' | 'deleted';
  } = {}): Promise<{ data: Org[]; nextCursor: string | null; hasMore: boolean }> {
    const limit = Math.min(Math.max(1, params.limit ?? 20), 100);
    const decoded = params.cursor ? decodeCursor(params.cursor) : null;

    const qb = this.orgRepo
      .createQueryBuilder('o')
      .withDeleted()
      .orderBy('o.createdAt', 'ASC')
      .addOrderBy('o.id', 'ASC')
      .take(limit + 1);

    if (params.search?.trim()) {
      const q = `%${params.search.trim()}%`;
      qb.where('(o.name ILIKE :q OR o.nit ILIKE :q)', { q });
    }

    if (params.status === 'deleted') {
      qb.andWhere('o.deletedAt IS NOT NULL');
    } else if (params.status === 'active') {
      qb.andWhere('o.deletedAt IS NULL').andWhere('o.status = :s', { s: OrgStatus.ACTIVE });
    } else if (params.status === 'inactive') {
      qb.andWhere('o.deletedAt IS NULL').andWhere('o.status != :s', { s: OrgStatus.ACTIVE });
    }

    if (decoded) {
      qb.andWhere(
        '(o.createdAt > :at OR (o.createdAt = :at AND o.id > :cursorId))',
        { at: decoded.at, cursorId: decoded.id },
      );
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const last = data.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    return { data, nextCursor, hasMore };
  }

  async findOne(id: string): Promise<Org> {
    const org = await this.orgRepo.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);
    return org;
  }

  async update(id: string, dto: UpdateOrgDto, actorId?: string): Promise<Org> {
    const org = await this.findOne(id);

    if (dto.name && dto.name !== org.name) {
      const existing = await this.orgRepo.findOne({ where: { name: dto.name } });
      if (existing) {
        throw new ConflictException(`Organization with name "${dto.name}" already exists`);
      }
    }

    const before: Record<string, unknown> = {};
    for (const key of Object.keys(dto)) before[key] = (org as unknown as Record<string, unknown>)[key];

    Object.assign(org, {
      ...(dto.name    !== undefined && { name:    dto.name }),
      ...(dto.nit     !== undefined && { nit:     dto.nit }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.phone   !== undefined && { phone:   dto.phone }),
      ...(dto.status  !== undefined && { status:  dto.status }),
    });

    const updated = await this.orgRepo.save(org);

    if (actorId) {
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of Object.keys(dto)) {
        const to = (dto as Record<string, unknown>)[key];
        if (before[key] !== to) changes[key] = { from: before[key], to };
      }
      this.emitAuditLog('COMPANY_UPDATED', updated, actorId, { changes });
    }
    return updated;
  }

  async remove(id: string, actorId?: string): Promise<void> {
    const org = await this.findOne(id);

    // Soft-delete first so the org is already marked deleted before cross-service calls.
    // If revokeOrgAccess fails we compensate by restoring the record — the worst-case
    // inconsistency is a briefly soft-deleted org that gets rolled back, which is
    // recoverable. The inverse order risks an active org with no memberships, which is not.
    await this.orgRepo.softRemove(org);

    try {
      await this.userClient.revokeOrgAccess(id);
    } catch (err) {
      this.logger.error(
        `revokeOrgAccess failed for org ${id} — compensating by restoring the record`,
        (err as Error).stack,
      );
      try {
        await this.orgRepo.restore(id);
      } catch (restoreErr) {
        this.logger.error(
          `restore failed while compensating org ${id}`,
          (restoreErr as Error).stack,
        );
      }
      throw err;
    }

    if (actorId) this.emitAuditLog('COMPANY_DELETED', org, actorId);
  }

  async findByIds(ids: string[]): Promise<Org[]> {
    if (ids.length === 0) return [];
    return this.orgRepo.findBy({ id: In(ids) });
  }

  async restore(id: string, actorId?: string): Promise<Org> {
    const org = await this.orgRepo.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);
    if (!org.deletedAt) throw new ConflictException(`Organization ${id} is not deleted`);

    await this.orgRepo.restore(id);
    const restored = await this.findOne(id);
    if (actorId) this.emitAuditLog('COMPANY_RESTORED', restored, actorId);
    return restored;
  }
}

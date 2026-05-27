import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Org, OrgStatus } from './entities/org.entity';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';
import { TOPICS } from '../common/kafka/kafka.constants';
import { getClientIp } from '../common/correlation/correlation.context';

@Injectable()
export class OrgsService {
  private readonly logger = new Logger(OrgsService.name);

  constructor(
    @InjectRepository(Org)
    private readonly orgRepo: Repository<Org>,
    private readonly configService: ConfigService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  private emitAuditLog(
    action: string,
    org: Org,
    actorId: string,
  ): void {
    this.kafkaProducer.emitSafe(TOPICS.AUDIT_LOG, {
      service:      'org-service',
      actorId,
      orgId:        null,
      action,
      resourceType: 'company',
      resourceId:   org.id,
      resourceName: org.name,
      ip:           getClientIp(),
      timestamp:    new Date().toISOString(),
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

  async findAll(): Promise<Org[]> {
    return this.orgRepo.find({ order: { createdAt: 'ASC' }, withDeleted: true });
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

    Object.assign(org, {
      ...(dto.name    !== undefined && { name:    dto.name }),
      ...(dto.nit     !== undefined && { nit:     dto.nit }),
      ...(dto.address !== undefined && { address: dto.address }),
      ...(dto.phone   !== undefined && { phone:   dto.phone }),
      ...(dto.status  !== undefined && { status:  dto.status }),
    });

    const updated = await this.orgRepo.save(org);
    if (actorId) this.emitAuditLog('COMPANY_UPDATED', updated, actorId);
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
      await this.revokeOrgAccess(id);
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

  private async revokeOrgAccess(orgId: string): Promise<void> {
    const userServiceUrl = this.configService.getOrThrow<string>('USER_SERVICE_URL');
    const internalToken = this.configService.getOrThrow<string>('INTERNAL_TOKEN');
    const url = `${userServiceUrl}/api/users/internal/orgs/${orgId}/users`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        signal: controller.signal,
        headers: { 'x-internal-token': internalToken },
      });
      if (!res.ok && res.status !== 404) {
        this.logger.error(`Failed to revoke org access for ${orgId}: HTTP ${res.status}`);
        throw new InternalServerErrorException('Failed to revoke user access after org deletion');
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        this.logger.error(`Timeout revoking org access for ${orgId}`);
        throw new InternalServerErrorException('Timeout revoking user access after org deletion');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
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

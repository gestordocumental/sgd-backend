import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Org, OrgStatus } from './entities/org.entity';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';

@Injectable()
export class OrgsService {
  constructor(
    @InjectRepository(Org)
    private readonly orgRepo: Repository<Org>,
  ) {}

  async create(dto: CreateOrgDto, createdBy: string | null): Promise<Org> {
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

    return this.orgRepo.save(org);
  }

  async findAll(): Promise<Org[]> {
    return this.orgRepo.find({ order: { createdAt: 'ASC' } });
  }

  async findOne(id: string): Promise<Org> {
    const org = await this.orgRepo.findOne({ where: { id } });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);
    return org;
  }

  async update(id: string, dto: UpdateOrgDto): Promise<Org> {
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

    return this.orgRepo.save(org);
  }

  async remove(id: string): Promise<void> {
    const org = await this.findOne(id);
    await this.orgRepo.softRemove(org);
  }

  async restore(id: string): Promise<Org> {
    const org = await this.orgRepo.findOne({
      where: { id },
      withDeleted: true,
    });
    if (!org) throw new NotFoundException(`Organization ${id} not found`);
    if (!org.deletedAt) throw new ConflictException(`Organization ${id} is not deleted`);

    await this.orgRepo.restore(id);
    return this.findOne(id);
  }
}

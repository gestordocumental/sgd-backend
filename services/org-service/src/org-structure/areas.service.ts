import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Area } from './entities/area.entity';
import { CreateAreaDto } from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';
import { DepartamentosService } from './departamentos.service';

@Injectable()
export class AreasService {
  constructor(
    @InjectRepository(Area)
    private readonly repo: Repository<Area>,
    private readonly departamentosService: DepartamentosService,
  ) {}

  async create(orgId: string, departamentoId: string, dto: CreateAreaDto): Promise<Area> {
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
    return this.repo.save(area);
  }

  findAll(orgId: string, departamentoId: string): Promise<Area[]> {
    return this.repo.find({ where: { orgId, departamentoId }, order: { name: 'ASC' } });
  }

  async findOne(orgId: string, departamentoId: string, id: string): Promise<Area> {
    const area = await this.repo.findOne({ where: { id, orgId, departamentoId } });
    if (!area) throw new NotFoundException(`Area ${id} not found`);
    return area;
  }

  async update(orgId: string, departamentoId: string, id: string, dto: UpdateAreaDto): Promise<Area> {
    const area = await this.findOne(orgId, departamentoId, id);

    if (dto.name && dto.name !== area.name) {
      const existing = await this.repo.findOne({ where: { departamentoId, name: dto.name } });
      if (existing) {
        throw new ConflictException(`Area "${dto.name}" already exists in this departamento`);
      }
    }

    Object.assign(area, {
      ...(dto.name        !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    });
    return this.repo.save(area);
  }

  async remove(orgId: string, departamentoId: string, id: string): Promise<void> {
    const area = await this.findOne(orgId, departamentoId, id);
    await this.repo.softRemove(area);
  }

  async restore(orgId: string, departamentoId: string, id: string): Promise<Area> {
    const area = await this.repo.findOne({ where: { id, orgId, departamentoId }, withDeleted: true });
    if (!area) throw new NotFoundException(`Area ${id} not found`);
    if (!area.deletedAt) throw new ConflictException(`Area ${id} is not deleted`);
    await this.repo.restore(id);
    return this.findOne(orgId, departamentoId, id);
  }
}

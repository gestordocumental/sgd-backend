import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Departamento } from './entities/departamento.entity';
import { CreateDepartamentoDto } from './dto/create-departamento.dto';
import { UpdateDepartamentoDto } from './dto/update-departamento.dto';

@Injectable()
export class DepartamentosService {
  constructor(
    @InjectRepository(Departamento)
    private readonly repo: Repository<Departamento>,
  ) {}

  async create(orgId: string, dto: CreateDepartamentoDto): Promise<Departamento> {
    const existing = await this.repo.findOne({ where: { orgId, name: dto.name } });
    if (existing) {
      throw new ConflictException(`Departamento "${dto.name}" already exists in this organization`);
    }

    const departamento = this.repo.create({
      orgId,
      name: dto.name,
      description: dto.description ?? null,
    });
    return this.repo.save(departamento);
  }

  findAll(orgId: string): Promise<Departamento[]> {
    return this.repo.find({ where: { orgId }, order: { name: 'ASC' } });
  }

  async findOne(orgId: string, id: string): Promise<Departamento> {
    const departamento = await this.repo.findOne({ where: { id, orgId } });
    if (!departamento) throw new NotFoundException(`Departamento ${id} not found`);
    return departamento;
  }

  async update(orgId: string, id: string, dto: UpdateDepartamentoDto): Promise<Departamento> {
    const departamento = await this.findOne(orgId, id);

    if (dto.name && dto.name !== departamento.name) {
      const existing = await this.repo.findOne({ where: { orgId, name: dto.name } });
      if (existing) {
        throw new ConflictException(`Departamento "${dto.name}" already exists in this organization`);
      }
    }

    Object.assign(departamento, {
      ...(dto.name        !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    });
    return this.repo.save(departamento);
  }

  async remove(orgId: string, id: string): Promise<void> {
    const departamento = await this.findOne(orgId, id);
    await this.repo.softRemove(departamento);
  }

  async restore(orgId: string, id: string): Promise<Departamento> {
    const departamento = await this.repo.findOne({ where: { id, orgId }, withDeleted: true });
    if (!departamento) throw new NotFoundException(`Departamento ${id} not found`);
    if (!departamento.deletedAt) throw new ConflictException(`Departamento ${id} is not deleted`);
    const nameConflict = await this.repo.findOne({ where: { orgId, name: departamento.name } });
    if (nameConflict) throw new ConflictException(`Departamento "${departamento.name}" already exists in this organization`);
    await this.repo.restore(id);
    return this.findOne(orgId, id);
  }
}

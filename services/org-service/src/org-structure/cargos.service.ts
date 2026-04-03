import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cargo } from './entities/cargo.entity';
import { CreateCargoDto } from './dto/create-cargo.dto';
import { UpdateCargoDto } from './dto/update-cargo.dto';
import { AreasService } from './areas.service';

@Injectable()
export class CargosService {
  constructor(
    @InjectRepository(Cargo)
    private readonly repo: Repository<Cargo>,
    private readonly areasService: AreasService,
  ) {}

  async create(
    orgId: string,
    departamentoId: string,
    areaId: string,
    dto: CreateCargoDto,
  ): Promise<Cargo> {
    // Validate parent area exists in this org/departamento
    await this.areasService.findOne(orgId, departamentoId, areaId);

    const existing = await this.repo.findOne({ where: { areaId, name: dto.name } });
    if (existing) {
      throw new ConflictException(`Cargo "${dto.name}" already exists in this area`);
    }

    const cargo = this.repo.create({
      orgId,
      areaId,
      departamentoId,
      name: dto.name,
      description: dto.description ?? null,
    });
    return this.repo.save(cargo);
  }

  findAll(orgId: string, departamentoId: string, areaId: string): Promise<Cargo[]> {
    return this.repo.find({ where: { orgId, departamentoId, areaId }, order: { name: 'ASC' } });
  }

  async findOne(orgId: string, departamentoId: string, areaId: string, id: string): Promise<Cargo> {
    const cargo = await this.repo.findOne({ where: { id, orgId, departamentoId, areaId } });
    if (!cargo) throw new NotFoundException(`Cargo ${id} not found`);
    return cargo;
  }

  async update(
    orgId: string,
    departamentoId: string,
    areaId: string,
    id: string,
    dto: UpdateCargoDto,
  ): Promise<Cargo> {
    const cargo = await this.findOne(orgId, departamentoId, areaId, id);

    if (dto.name && dto.name !== cargo.name) {
      const existing = await this.repo.findOne({ where: { areaId, name: dto.name } });
      if (existing) {
        throw new ConflictException(`Cargo "${dto.name}" already exists in this area`);
      }
    }

    Object.assign(cargo, {
      ...(dto.name        !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    });
    return this.repo.save(cargo);
  }

  async remove(orgId: string, departamentoId: string, areaId: string, id: string): Promise<void> {
    const cargo = await this.findOne(orgId, departamentoId, areaId, id);
    await this.repo.softRemove(cargo);
  }

  async restore(orgId: string, departamentoId: string, areaId: string, id: string): Promise<Cargo> {
    const cargo = await this.repo.findOne({ where: { id, orgId, departamentoId, areaId }, withDeleted: true });
    if (!cargo) throw new NotFoundException(`Cargo ${id} not found`);
    if (!cargo.deletedAt) throw new ConflictException(`Cargo ${id} is not deleted`);
    await this.repo.restore(id);
    return this.findOne(orgId, departamentoId, areaId, id);
  }
}

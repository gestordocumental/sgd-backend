import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Role, RoleScope } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignPermissionsDto } from './dto/assign-permissions.dto';

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly rolesRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionsRepository: Repository<Permission>,
  ) {}

  // Returns system roles + custom roles for the given org
  findAll(orgId: string): Promise<Role[]> {
    return this.rolesRepository.find({
      where: [{ orgId: null }, { orgId }],
      relations: ['permissions'],
      order: { isSystem: 'DESC', name: 'ASC' },
    });
  }

  async findOne(id: string, orgId: string): Promise<Role> {
    const role = await this.rolesRepository.findOne({
      where: [{ id, orgId: null }, { id, orgId }],
      relations: ['permissions'],
    });
    if (!role) throw new NotFoundException(`Role ${id} not found`);
    return role;
  }

  async create(dto: CreateRoleDto, orgId: string): Promise<Role> {
    const existing = await this.rolesRepository.findOne({
      where: { name: dto.name, orgId },
    });
    if (existing) throw new ConflictException(`Role "${dto.name}" already exists in this organization`);

    const permissions = dto.permissionIds?.length
      ? await this.permissionsRepository.findBy({ id: In(dto.permissionIds) })
      : [];

    const role = this.rolesRepository.create({
      name: dto.name,
      description: dto.description ?? null,
      scope: RoleScope.ORG,
      isSystem: false,
      orgId,
      permissions,
    });

    return this.rolesRepository.save(role);
  }

  async update(id: string, dto: UpdateRoleDto, orgId: string): Promise<Role> {
    const role = await this.findOne(id, orgId);
    if (role.isSystem) throw new ForbiddenException('System roles cannot be modified');

    // Only allow updating roles that belong to this org
    if (role.orgId !== orgId) throw new ForbiddenException('Cannot modify roles from another organization');

    Object.assign(role, dto);
    return this.rolesRepository.save(role);
  }

  async remove(id: string, orgId: string): Promise<void> {
    const role = await this.findOne(id, orgId);
    if (role.isSystem) throw new ForbiddenException('System roles cannot be deleted');
    if (role.orgId !== orgId) throw new ForbiddenException('Cannot delete roles from another organization');

    await this.rolesRepository.remove(role);
  }

  async assignPermissions(id: string, dto: AssignPermissionsDto, orgId: string): Promise<Role> {
    const role = await this.findOne(id, orgId);
    if (role.isSystem) throw new ForbiddenException('System role permissions cannot be modified');
    if (role.orgId !== orgId) throw new ForbiddenException('Cannot modify roles from another organization');

    const permissions = await this.permissionsRepository.findBy({
      id: In(dto.permissionIds),
    });

    role.permissions = permissions;
    return this.rolesRepository.save(role);
  }

  async removePermission(roleId: string, permissionId: string, orgId: string): Promise<Role> {
    const role = await this.findOne(roleId, orgId);
    if (role.isSystem) throw new ForbiddenException('System role permissions cannot be modified');
    if (role.orgId !== orgId) throw new ForbiddenException('Cannot modify roles from another organization');

    role.permissions = role.permissions.filter((p) => p.id !== permissionId);
    return this.rolesRepository.save(role);
  }
}

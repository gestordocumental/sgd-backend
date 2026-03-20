import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserOrgRole } from '../../roles/entities/user-org-role.entity';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionModule, PermissionAction } from '../../roles/entities/permission.entity';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepo: Repository<UserOrgRole>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<{ module: PermissionModule; action: PermissionAction }>(
      PERMISSION_KEY,
      ctx.getHandler(),
    );

    // Endpoints sin @RequirePermission pasan directamente
    if (!required) return true;

    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();
    const auth = request.headers['authorization'];

    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');

    const parts = auth.split(' ')[1].split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Malformed token');

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Malformed token');
    }

    // Super admin tiene acceso a todo
    if (payload.isSuperAdmin) return true;

    const userId = payload.sub as string | undefined;
    const companyId = payload.companyId as string | undefined;

    if (!userId) throw new UnauthorizedException('Token has no sub claim');
    if (!companyId) {
      throw new ForbiddenException('Token has no companyId — call POST /api/auth/switch-company first');
    }

    // Un usuario puede tener múltiples roles en la misma org
    const userOrgRoles = await this.userOrgRoleRepo.find({
      where: { userId, orgId: companyId },
      relations: ['role', 'role.permissions'],
    });

    if (!userOrgRoles.length) {
      throw new ForbiddenException('User has no role in this organization');
    }

    const hasPermission = userOrgRoles.some((uor) =>
      uor.role.permissions.some(
        (p) => p.module === required.module && p.action === required.action,
      ),
    );

    if (!hasPermission) throw new ForbiddenException('Insufficient permissions');

    return true;
  }
}

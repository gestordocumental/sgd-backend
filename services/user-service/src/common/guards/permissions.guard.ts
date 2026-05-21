import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';

function verifyAndDecodeJwt(token: string, secret: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new UnauthorizedException('Malformed token');
  const [header, payload, signature] = parts;
  const sigBytes = Buffer.from(signature, 'base64url');
  const expectedBytes = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
  if (sigBytes.length !== expectedBytes.length || !timingSafeEqual(sigBytes, expectedBytes)) {
    throw new UnauthorizedException('Invalid token');
  }
  let decoded: Record<string, unknown>;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new UnauthorizedException('Malformed token');
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof decoded['exp'] !== 'number' || decoded['exp'] < nowSec) {
    throw new UnauthorizedException('Token expired');
  }
  return decoded;
}
import { UserOrgRole } from '../../roles/entities/user-org-role.entity';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionModule, PermissionAction } from '../../roles/entities/permission.entity';

interface CachedPermissions {
  permissions: { module: string; action: string }[];
  expiresAt: number;
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  // In-memory permissions cache: key = `userId:companyId`
  private readonly permissionsCache = new Map<string, CachedPermissions>();
  private readonly CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepo: Repository<UserOrgRole>,
  ) {}

  /** Invalidate cached permissions for a user (call after role changes). */
  invalidate(userId: string, companyId: string): void {
    this.permissionsCache.delete(`${userId}:${companyId}`);
  }

  /** Remove all expired entries to prevent unbounded memory growth in long-running services. */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.permissionsCache) {
      if (entry.expiresAt <= now) this.permissionsCache.delete(key);
    }
  }

  private async resolvePermissions(
    userId: string,
    companyId: string,
  ): Promise<{ module: string; action: string }[]> {
    const key = `${userId}:${companyId}`;
    const cached = this.permissionsCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.permissions;
    }

    const userOrgRoles = await this.userOrgRoleRepo.find({
      where: { userId, orgId: companyId },
      relations: ['role', 'role.permissions'],
    });

    if (!userOrgRoles.length) {
      throw new ForbiddenException('User has no role in this organization');
    }

    const permissions = userOrgRoles.flatMap(
      (uor) =>
        uor.role?.permissions?.map((p) => ({ module: p.module as string, action: p.action as string })) ?? [],
    );

    this.evictExpired();
    this.permissionsCache.set(key, { permissions, expiresAt: Date.now() + this.CACHE_TTL_MS });
    return permissions;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<{ module: PermissionModule; action: PermissionAction }>(
      PERMISSION_KEY,
      ctx.getHandler(),
    );

    // Endpoints without @RequirePermission pass through directly
    if (!required) return true;

    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string> }>();

    // Internal calls between microservices — skip JWT validation
    const internalToken = request.headers['x-internal-token'];
    if (internalToken) {
      const expected = Buffer.from(this.configService.getOrThrow<string>('INTERNAL_TOKEN'));
      const provided = Buffer.from(internalToken);
      const isValid =
        provided.length === expected.length && timingSafeEqual(expected, provided);
      if (isValid) return true;
    }

    const auth = request.headers['authorization'];

    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('Missing token');

    const jwtSecret = this.configService.getOrThrow<string>('JWT_SECRET');
    const payload = verifyAndDecodeJwt(auth.split(' ')[1], jwtSecret);

    // Super admin has access to everything
    if (payload.isSuperAdmin) return true;

    const userId = payload.sub as string | undefined;
    const companyId = payload.companyId as string | undefined;

    if (!userId) throw new UnauthorizedException('Token has no sub claim');
    if (!companyId) {
      throw new ForbiddenException('Token has no companyId — call POST /api/auth/switch-company first');
    }

    const permissions = await this.resolvePermissions(userId, companyId);

    const hasPermission = permissions.some(
      (p) => p.module === required.module && p.action === required.action,
    );

    if (!hasPermission) throw new ForbiddenException('Insufficient permissions');

    return true;
  }
}

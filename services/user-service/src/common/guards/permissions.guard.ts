import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Redis } from 'ioredis';
import { UserOrgRole } from '../../roles/entities/user-org-role.entity';
import { PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { PermissionModule, PermissionAction } from '../../roles/entities/permission.entity';

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
const CACHE_TTL_SECONDS = 120; // 2 minutes

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    @InjectRepository(UserOrgRole)
    private readonly userOrgRoleRepo: Repository<UserOrgRole>,
    @Inject('REDIS_CLIENT')
    private readonly redis: Redis,
  ) {}

  /** Invalidate cached permissions for a user in all service instances. */
  async invalidate(userId: string, companyId: string): Promise<void> {
    await this.redis.del(`perms:${userId}:${companyId}`);
  }

  private async resolvePermissions(
    userId: string,
    companyId: string,
  ): Promise<{ module: string; action: string }[]> {
    const key = `perms:${userId}:${companyId}`;
    const cached = await this.redis.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as { module: string; action: string }[];
      } catch {
        await this.redis.del(key);
      }
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

    try {
      await this.redis.set(key, JSON.stringify(permissions), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Cache write failure must not block an already-authorized request
    }
    return permissions;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<{ module: PermissionModule; action: PermissionAction }>(
      PERMISSION_KEY,
      ctx.getHandler(),
    );

    const request = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; user?: Record<string, unknown> }>();

    // Internal calls between microservices — skip JWT validation.
    // Each key identifies one (caller → user-service) pair; any valid caller is allowed through.
    const internalToken = request.headers['x-internal-token'];
    if (internalToken) {
      const allowed = [
        'INTERNAL_TOKEN_AUTH_USER',
        'INTERNAL_TOKEN_NOTIF_USER',
        'INTERNAL_TOKEN_WORKFLOW_USER',
        'INTERNAL_TOKEN_ORG_USER',
      ]
        .map((k) => this.configService.get<string>(k))
        .filter((t): t is string => !!t)
        .map((t) => Buffer.from(t));
      const provided = Buffer.from(internalToken);
      const isValid = allowed.some(
        (expected) =>
          provided.length === expected.length && timingSafeEqual(expected, provided),
      );
      if (isValid) return true;
    }

    const auth = request.headers['authorization'];

    // Decode JWT and populate request.user whenever a Bearer token is present,
    // so @JwtPayloadParam() works on all endpoints (with or without @RequirePermission).
    if (auth?.startsWith('Bearer ')) {
      const jwtSecret = this.configService.getOrThrow<string>('JWT_SECRET');
      const payload = verifyAndDecodeJwt(auth.split(' ')[1], jwtSecret);
      request.user = payload;

      // Endpoints without @RequirePermission pass through after populating user
      if (!required) return true;

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

    // No Bearer token present
    if (!required) return true;
    throw new UnauthorizedException('Missing token');
  }
}

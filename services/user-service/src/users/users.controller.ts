import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ParseIntPipe,
  DefaultValuePipe,
  UnauthorizedException,
  ForbiddenException,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { randomUUID, timingSafeEqual } from "crypto";
// file-type v17+ is ESM-only — use dynamic import at call site
import { StorageService } from "../common/storage/storage.service";
import {
  ApiTags, ApiOperation, ApiResponse, ApiBody, ApiBearerAuth, ApiSecurity, ApiParam,
} from '@nestjs/swagger';
import { ConfigService } from "@nestjs/config";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { ProvisionUserDto } from "./dto/provision-user.dto";
import { AssignOrgDto } from "./dto/assign-org.dto";
import { CompleteRegistrationDto } from "./dto/complete-registration.dto";
import { CreateUserResponseDto } from "./dto/create-user-response.dto";
import { UserResponseDto } from "./dto/user-response.dto";
import { UserWithOrgRolesDto } from "./dto/user-with-org-roles.dto";
import { UserOrgRoleResponseDto } from "./dto/user-org-role-response.dto";
import { SetSuperAdminDto } from "./dto/super-admin.dto";
import { SetOptionalReviewerDto } from "./dto/set-optional-reviewer.dto";
import { RequireSuperAdmin } from "../common/decorators/require-super-admin.decorator";
import { CurrentUserId } from "../common/decorators/current-user-id.decorator";
import { JwtPayloadParam, JwtPayload } from '@sgd/common';
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionModule, PermissionAction } from "../roles/entities/permission.entity";

@ApiTags('Users')
@ApiBearerAuth('JWT')
@Controller("api/v1/users")
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  private verifyInternalToken(token: string | undefined, keys: string[]): void {
    const allowed = keys
      .map((k) => this.configService.get<string>(k))
      .filter((t): t is string => !!t)
      .map((t) => Buffer.from(t));

    const provided = Buffer.from(token ?? '');
    const valid = allowed.some(
      (expected) =>
        provided.length === expected.length && timingSafeEqual(expected, provided),
    );
    if (!valid) throw new UnauthorizedException();
  }

  @ApiOperation({ summary: 'Create a new user and send invitation email' })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({ status: 201, description: 'User created, returns user + invitationToken', type: CreateUserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — invalid DTO fields' })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  @Post()
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async create(
    @JwtPayloadParam() caller: JwtPayload,
    @Body() dto: CreateUserDto,
  ) {
    // Only super admins can create super admin users
    if (dto.isSuperAdmin && !caller.isSuperAdmin) {
      throw new ForbiddenException('Only super admins can grant super admin privileges');
    }

    // orgId must belong to the caller's own org unless they are a super admin
    if (dto.orgId && !caller.isSuperAdmin && dto.orgId !== caller.companyId) {
      throw new ForbiddenException('You can only assign users to your own organization');
    }

    const { user, invitationToken } = await this.usersService.create(dto, caller.sub, caller.companyId);
    return { ...UserResponseDto.from(user), invitationToken };
  }

  @ApiOperation({ summary: 'List all users (cursor-paginated)' })
  @ApiResponse({ status: 200, description: 'Cursor-paginated users' })
  @Get()
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findAll(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ): Promise<{ data: UserResponseDto[]; nextCursor: string | null; hasMore: boolean }> {
    const result = await this.usersService.findAll(limit, cursor);
    return { data: result.data.map(UserResponseDto.from), nextCursor: result.nextCursor, hasMore: result.hasMore };
  }

  @ApiOperation({ summary: 'User counts grouped by organization — super admin only' })
  @Get('admin/counts-by-org')
  countsByOrg(@RequireSuperAdmin() _caller: void) {
    return this.usersService.getCountsByOrg();
  }

  @ApiOperation({ summary: 'List all super admin users (cursor-paginated, with server-side search and status filter)' })
  @ApiResponse({ status: 200, description: 'Cursor-paginated super admin users' })
  @Get("super-admins")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findAllSuperAdmin(
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
    @Query('search') search?: string,
    @Query('status') status?: 'active' | 'inactive' | 'deleted' | 'pending',
  ): Promise<{ data: UserResponseDto[]; nextCursor: string | null; hasMore: boolean; total: number }> {
    if (status && !['active', 'inactive', 'deleted', 'pending'].includes(status)) {
      throw new BadRequestException('status must be one of: active, inactive, deleted, pending');
    }
    const result = await this.usersService.findAllSuperAdmin(limit, cursor, search, status);
    return { data: result.data.map(UserResponseDto.from), nextCursor: result.nextCursor, hasMore: result.hasMore, total: result.total };
  }

  @ApiOperation({ summary: 'Find user by email' })
  @ApiResponse({ status: 200, description: 'User found', type: UserResponseDto })
  @Get("by-email/:email")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findByEmail(@Param("email") email: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.findByEmail(email));
  }

  @ApiOperation({ summary: 'List users belonging to an organization (cursor-paginated)' })
  @ApiParam({ name: 'orgId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Cursor-paginated users' })
  @Get('by-org/:orgId')
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findByOrg(
    @Param('orgId', new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('cursor') cursor?: string,
  ): Promise<{ data: UserWithOrgRolesDto[]; nextCursor: string | null; hasMore: boolean }> {
    const result = await this.usersService.findByOrg(orgId, limit, cursor);
    return {
      data: result.data.map(({ user, roles, orgRemovedAt, isOptionalReviewer }) =>
        UserWithOrgRolesDto.fromUserAndRoles(user, roles, orgRemovedAt, isOptionalReviewer),
      ),
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
    };
  }

  /**
   * Returns the caller's own profile. No @RequirePermission needed — a user
   * can always read their own data regardless of their assigned role.
   */
  @ApiOperation({ summary: "Get the logged-in user's own profile" })
  @ApiResponse({ status: 200, description: 'Caller profile', type: UserResponseDto })
  @Get('me')
  async getMe(@JwtPayloadParam() caller: JwtPayload): Promise<UserResponseDto> {
    if (!caller.sub) throw new UnauthorizedException('Missing sub claim');
    return UserResponseDto.from(await this.usersService.findOne(caller.sub));
  }

  /**
   * Returns the caller's own role assignments for their current company (from JWT companyId).
   * No @RequirePermission needed — a user can always read their own roles.
   * Used by the frontend to derive which UI sections to display.
   */
  @ApiOperation({ summary: "Get caller's role assignments for their current company" })
  @ApiResponse({ status: 200, description: 'Returns role assignments', type: UserOrgRoleResponseDto, isArray: true })
  @Get("me/org-roles")
  getMyOrgRoles(@JwtPayloadParam() caller: JwtPayload): Promise<UserOrgRoleResponseDto[]> {
    if (!caller.sub) throw new UnauthorizedException('Missing sub claim');
    if (!caller.companyId) throw new ForbiddenException('No company context — call switch-company first');
    return this.usersService.getMyOrgRoles(caller.sub, caller.companyId).then(
      (roles) => roles.map(UserOrgRoleResponseDto.from),
    );
  }

  @ApiOperation({ summary: "Upload avatar for the logged-in user" })
  @ApiResponse({ status: 200, description: 'Avatar uploaded', type: UserResponseDto })
  @Patch("me/avatar")
  @UseInterceptors(
    FileInterceptor("avatar", {
      // Use memory storage so we can inspect the buffer before writing to disk.
      storage: memoryStorage(),
      fileFilter: (_req: any, file: Express.Multer.File, cb: (error: Error | null, acceptFile: boolean) => void) => {
        // First-pass: reject by declared MIME type (fast, client-side signal).
        // A deeper magic-byte check runs in the handler after multer buffers the file.
        if (!file.mimetype.match(/^image\/(jpeg|png|webp|gif)$/)) {
          return cb(new BadRequestException("Only image files are allowed"), false);
        }
        cb(null, true);
      },
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    }),
  )
  async uploadAvatar(
    @CurrentUserId() userId: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UserResponseDto> {
    if (!file) throw new BadRequestException("No file uploaded");

    // Second-pass: validate actual file content via magic bytes.
    const { fileTypeFromBuffer } = await import('file-type');
    const type = await fileTypeFromBuffer(file.buffer);
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!type || !allowedMimes.includes(type.mime)) {
      throw new BadRequestException("File content does not match an allowed image format");
    }

    // Keep previous key — delete old object only after new avatar is persisted.
    const existing = await this.usersService.findOne(userId);
    const oldKey = existing.avatarUrl
      ? this.storageService.extractKey(existing.avatarUrl)
      : null;

    // Upload to object storage and persist the public URL.
    const key      = `avatars/${randomUUID()}.${type.ext}`;
    const publicUrl = await this.storageService.upload(key, file.buffer, type.mime);

    const user = await this.usersService.uploadAvatar(userId, publicUrl);
    if (oldKey) void this.storageService.delete(oldKey).catch(() => {});
    return UserResponseDto.from(user);
  }

  @ApiOperation({ summary: 'Revoke all user access for an org — internal only, called on org deletion' })
  @ApiSecurity('internal-token')
  @ApiParam({ name: 'orgId', format: 'uuid' })
  @Delete("internal/orgs/:orgId/users")
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeAllFromOrg(
    @Headers("x-internal-token") internalToken: string,
    @Param("orgId", new ParseUUIDPipe({ version: '4' })) orgId: string,
  ): Promise<void> {
    // Only org-service is authorized to call this endpoint
    this.verifyInternalToken(internalToken, ['INTERNAL_TOKEN_ORG_USER']);
    await this.usersService.removeAllFromOrg(orgId);
  }

  @ApiOperation({ summary: 'Get effective permissions for a user in an org (internal only)' })
  @ApiSecurity('internal-token')
  @ApiParam({ name: 'id', format: 'uuid' })
  @Get(":id/effective-permissions")
  async getEffectivePermissions(
    @Headers("x-internal-token") internalToken: string,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
    @Query("companyId", new ParseUUIDPipe({ version: '4' })) companyId: string,
  ): Promise<{ module: string; action: string }[]> {
    // Only auth-service is authorized to call this endpoint
    this.verifyInternalToken(internalToken, ['INTERNAL_TOKEN_AUTH_USER']);
    return this.usersService.getEffectivePermissions(id, companyId);
  }

  @ApiOperation({ summary: "Get companies a user belongs to (internal only)" })
  @ApiSecurity('internal-token')
  @ApiParam({ name: 'id', format: 'uuid' })
  @Get(":id/companies")
  getCompanies(
    @Headers("x-internal-token") internalToken: string,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    // Only auth-service is authorized to call this endpoint
    this.verifyInternalToken(internalToken, ['INTERNAL_TOKEN_AUTH_USER']);
    return this.usersService.getCompanies(id);
  }

  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User found', type: UserResponseDto })
  @Get(":id")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findOne(
    @Headers("x-internal-token") internalToken: string | undefined,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<UserResponseDto> {
    // Service-to-service callers (e.g. auth-service) authenticate via internal token
    if (internalToken !== undefined) {
      this.verifyInternalToken(internalToken, ['INTERNAL_TOKEN_AUTH_USER']);
    }
    return UserResponseDto.from(await this.usersService.findOne(id));
  }

  @ApiOperation({ summary: 'Update user profile fields' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({ status: 200, description: 'User updated', type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — invalid DTO fields' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @Patch(":id")
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async update(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.update(id, dto, caller.sub, caller.companyId));
  }

  @ApiOperation({ summary: 'Soft delete a user' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'User deleted' })
  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionModule.USERS, PermissionAction.DELETE)
  remove(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    if (caller.companyId) {
      return this.usersService.removeFromOrg(id, caller.companyId, caller.sub);
    }
    return this.usersService.globalRemove(id, caller.sub);
  }

  @ApiOperation({ summary: 'Restore a previously deleted user' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User restored', type: UserResponseDto })
  @Post(":id/restore")
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async restore(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.restore(id, caller.sub));
  }

  @ApiOperation({ summary: 'Disable a user — blocks login without deleting the account' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User disabled', type: UserResponseDto })
  @Patch(":id/disable")
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async disable(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(
      await this.usersService.disable(id, {
        actorId: caller.sub,
        companyId: caller.companyId,
        isSuperAdmin: caller.isSuperAdmin,
      }),
    );
  }

  @ApiOperation({ summary: 'Enable a previously disabled user' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User enabled', type: UserResponseDto })
  @Patch(":id/enable")
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async enable(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(
      await this.usersService.enable(id, {
        actorId: caller.sub,
        companyId: caller.companyId,
        isSuperAdmin: caller.isSuperAdmin,
      }),
    );
  }

  @ApiOperation({ summary: 'Resend invitation email to a PENDING user' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'New invitation token generated and email sent', type: CreateUserResponseDto })
  @ApiResponse({ status: 409, description: 'User has already completed registration' })
  @Post(":id/resend-invitation")
  @HttpCode(HttpStatus.OK)
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async resendInvitation(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
  ) {
    const callerOrgId = caller.isSuperAdmin ? undefined : caller.companyId;
    const { user, invitationToken } = await this.usersService.resendInvitation(id, callerOrgId);
    return { ...UserResponseDto.from(user), invitationToken };
  }

  @ApiOperation({ summary: 'Complete registration using invitation token (public endpoint)' })
  @ApiBody({ type: CompleteRegistrationDto })
  @ApiResponse({ status: 200, description: 'Registration completed', type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — missing or invalid fields' })
  @ApiResponse({ status: 409, description: 'Token invalid, expired, or registration already completed' })
  @Post("complete-registration")
  async completeRegistration(@Body() dto: CompleteRegistrationDto): Promise<UserResponseDto> {
    return this.usersService.completeRegistration(dto);
  }

  @ApiOperation({ summary: 'Set initial password for a user (admin provisioning)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: ProvisionUserDto })
  @ApiResponse({ status: 201, description: 'Password provisioned' })
  @ApiResponse({ status: 400, description: 'Validation error — password too short or missing' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'User already has a password set' })
  @Post(":id/provision")
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  provision(@Param("id", new ParseUUIDPipe({ version: '4' })) id: string, @Body() dto: ProvisionUserDto) {
    return this.usersService.provision(id, dto);
  }

  @ApiOperation({ summary: 'Grant or revoke super admin privileges (super admin only)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: SetSuperAdminDto })
  @ApiResponse({ status: 200, description: 'User updated', type: UserResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — invalid body' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @Patch(":id/super-admin")
  async setSuperAdmin(
    @RequireSuperAdmin() _caller: void,
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: SetSuperAdminDto,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.setSuperAdmin(id, dto.enabled, caller.sub));
  }

  @ApiOperation({ summary: 'Assign a user to an organization with a role' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: AssignOrgDto })
  @ApiResponse({ status: 201, description: 'Organization assigned', type: UserOrgRoleResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error — invalid orgId or roleId' })
  @ApiResponse({ status: 404, description: 'User, organization, or role not found' })
  @ApiResponse({ status: 409, description: 'User already belongs to this organization' })
  @Post(":id/orgs")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(PermissionModule.USERS, PermissionAction.MANAGE)
  async assignOrg(
    @CurrentUserId() callerId: string,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: AssignOrgDto,
  ): Promise<UserOrgRoleResponseDto> {
    return UserOrgRoleResponseDto.from(
      await this.usersService.assignOrg(id, dto, callerId),
    );
  }

  @ApiOperation({ summary: "List a user's organization role assignments" })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Role assignments found', type: UserOrgRoleResponseDto, isArray: true })
  @Get(":id/orgs")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async getOrgRoles(
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<UserOrgRoleResponseDto[]> {
    return (await this.usersService.getOrgRoles(id)).map(UserOrgRoleResponseDto.from);
  }

  @ApiOperation({ summary: 'Remove a specific role from a user in an organization (keeps org membership)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'orgId', format: 'uuid' })
  @ApiParam({ name: 'roleId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Role removed from user' })
  @ApiResponse({ status: 404, description: 'User does not have this role in this org' })
  @Delete(":id/orgs/:orgId/roles/:roleId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionModule.USERS, PermissionAction.MANAGE)
  async removeRoleFromOrg(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
    @Param("orgId", new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Param("roleId", new ParseUUIDPipe({ version: '4' })) roleId: string,
  ): Promise<void> {
    if (!caller.isSuperAdmin && caller.companyId !== orgId) {
      throw new ForbiddenException('You can only remove roles from users in your own organization');
    }
    return this.usersService.removeRoleFromOrg(id, orgId, roleId, caller.sub);
  }

  @ApiOperation({ summary: 'Remove a user from an organization' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'orgId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'User removed from org' })
  @Delete(":id/orgs/:orgId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionModule.USERS, PermissionAction.MANAGE)
  async removeFromOrg(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
    @Param("orgId", new ParseUUIDPipe({ version: '4' })) orgId: string,
  ): Promise<void> {
    if (!caller.isSuperAdmin && caller.companyId !== orgId) {
      throw new ForbiddenException('You can only remove users from your own organization');
    }
    return this.usersService.removeFromOrg(id, orgId, caller.sub);
  }

  @ApiOperation({ summary: 'Set or clear the optional-reviewer flag for a user in a specific org' })
  @ApiParam({ name: 'id', format: 'uuid', description: 'User ID' })
  @ApiParam({ name: 'orgId', format: 'uuid', description: 'Organization ID' })
  @ApiBody({ type: SetOptionalReviewerDto })
  @ApiResponse({ status: 204, description: 'Flag updated' })
  @ApiResponse({ status: 400, description: 'Validation error — invalid body' })
  @ApiResponse({ status: 404, description: 'User is not a member of this org' })
  @Patch(":id/orgs/:orgId/optional-reviewer")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  setOptionalReviewer(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id", new ParseUUIDPipe({ version: '4' })) id: string,
    @Param("orgId", new ParseUUIDPipe({ version: '4' })) orgId: string,
    @Body() dto: SetOptionalReviewerDto,
  ): Promise<void> {
    if (!caller.isSuperAdmin && caller.companyId !== orgId) {
      throw new ForbiddenException('You can only update users in your own organization');
    }
    return this.usersService.setOptionalReviewer(id, orgId, dto.value, caller.sub);
  }
}

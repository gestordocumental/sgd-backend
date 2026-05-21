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
import { fromBuffer as fileTypeFromBuffer } from "file-type";
import { StorageService } from "../common/storage/storage.service";
import {
  ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiSecurity, ApiParam,
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
import { RequireSuperAdmin } from "../common/decorators/require-super-admin.decorator";
import { CurrentUserId } from "../common/decorators/current-user-id.decorator";
import { JwtPayloadParam, JwtPayload } from "../common/decorators/jwt-payload.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionModule, PermissionAction } from "../roles/entities/permission.entity";

@ApiTags('Users')
@ApiBearerAuth('JWT')
@Controller("api/users")
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
    private readonly storageService: StorageService,
  ) {}

  @ApiOperation({ summary: 'Create a new user and send invitation email' })
  @ApiResponse({ status: 201, description: 'User created, returns user + invitationToken', type: CreateUserResponseDto })
  @ApiResponse({ status: 403, description: 'Insufficient permissions' })
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

  @ApiOperation({ summary: 'List all users (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated users' })
  @Get()
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findAll(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ): Promise<{ data: UserResponseDto[]; total: number }> {
    const { data, total } = await this.usersService.findAll(page, limit);
    return { data: data.map(UserResponseDto.from), total };
  }

  @ApiOperation({ summary: 'User counts grouped by organization — super admin only' })
  @Get('admin/counts-by-org')
  countsByOrg(@RequireSuperAdmin() _caller: void) {
    return this.usersService.getCountsByOrg();
  }

  @ApiOperation({ summary: 'List all super admin users (paginated)' })
  @ApiResponse({ status: 200, description: 'Paginated super admin users' })
  @Get("super-admins")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findAllSuperAdmin(
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
  ): Promise<{ data: UserResponseDto[]; total: number }> {
    const { data, total } = await this.usersService.findAllSuperAdmin(page, limit);
    return { data: data.map(UserResponseDto.from), total };
  }

  @ApiOperation({ summary: 'Find user by email' })
  @ApiResponse({ status: 200, description: 'User found', type: UserResponseDto })
  @Get("by-email/:email")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findByEmail(@Param("email") email: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.findByEmail(email));
  }

  @ApiOperation({ summary: 'List users belonging to an organization' })
  @ApiParam({ name: 'orgId', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Users found', type: UserWithOrgRolesDto, isArray: true })
  @Get('by-org/:orgId')
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findByOrg(
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<UserWithOrgRolesDto[]> {
    return (await this.usersService.findByOrg(orgId)).map(({ user, roles }) =>
      UserWithOrgRolesDto.fromUserAndRoles(user, roles),
    );
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

  @ApiOperation({ summary: "Get companies a user belongs to (internal only)" })
  @ApiSecurity('internal-token')
  @ApiParam({ name: 'id', format: 'uuid' })
  @Get(":id/companies")
  getCompanies(
    @Headers("x-internal-token") internalToken: string,
    @Param("id") id: string,
  ) {
    const expected = Buffer.from(
      this.configService.getOrThrow<string>("INTERNAL_TOKEN"),
    );
    const provided = Buffer.from(internalToken ?? "");
    const isValid =
      provided.length === expected.length &&
      timingSafeEqual(expected, provided);
    if (!isValid) throw new UnauthorizedException();
    return this.usersService.getCompanies(id);
  }

  @ApiOperation({ summary: 'Get user by ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User found', type: UserResponseDto })
  @Get(":id")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findOne(@Param("id") id: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.findOne(id));
  }

  @ApiOperation({ summary: 'Update user profile fields' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User updated', type: UserResponseDto })
  @Patch(":id")
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async update(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id") id: string,
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
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.usersService.remove(id, caller.companyId, caller.sub);
  }

  @ApiOperation({ summary: 'Restore a previously deleted user' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User restored', type: UserResponseDto })
  @Post(":id/restore")
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async restore(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id") id: string,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.restore(id, caller.sub));
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
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const callerOrgId = caller.isSuperAdmin ? undefined : caller.companyId;
    const { user, invitationToken } = await this.usersService.resendInvitation(id, callerOrgId);
    return { ...UserResponseDto.from(user), invitationToken };
  }

  @ApiOperation({ summary: 'Complete registration using invitation token (public endpoint)' })
  @ApiResponse({ status: 200, description: 'Registration completed', type: UserResponseDto })
  @Post("complete-registration")
  async completeRegistration(@Body() dto: CompleteRegistrationDto): Promise<UserResponseDto> {
    return this.usersService.completeRegistration(dto);
  }

  @ApiOperation({ summary: 'Set initial password for a user (admin provisioning)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @Post(":id/provision")
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  provision(@Param("id") id: string, @Body() dto: ProvisionUserDto) {
    return this.usersService.provision(id, dto);
  }

  @ApiOperation({ summary: 'Grant or revoke super admin privileges (super admin only)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'User updated', type: UserResponseDto })
  @Patch(":id/super-admin")
  async setSuperAdmin(
    @RequireSuperAdmin() _caller: void,
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id") id: string,
    @Body() dto: SetSuperAdminDto,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.setSuperAdmin(id, dto.enabled, caller.sub));
  }

  @ApiOperation({ summary: 'Assign a user to an organization with a role' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 201, description: 'Organization assigned', type: UserOrgRoleResponseDto })
  @Post(":id/orgs")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(PermissionModule.USERS, PermissionAction.MANAGE)
  async assignOrg(
    @CurrentUserId() callerId: string,
    @Param("id") id: string,
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
    @Param("id") id: string,
  ): Promise<UserOrgRoleResponseDto[]> {
    return (await this.usersService.getOrgRoles(id)).map(UserOrgRoleResponseDto.from);
  }

  @ApiOperation({ summary: 'Remove a user from an organization' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiParam({ name: 'orgId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'User removed from org' })
  @Delete(":id/orgs/:orgId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionModule.USERS, PermissionAction.MANAGE)
  removeFromOrg(
    @JwtPayloadParam() caller: JwtPayload,
    @Param("id") id: string,
    @Param("orgId") orgId: string,
  ): Promise<void> {
    return this.usersService.removeFromOrg(id, orgId, caller.sub);
  }
}

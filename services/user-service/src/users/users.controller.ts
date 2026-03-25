import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { ProvisionUserDto } from "./dto/provision-user.dto";
import { AssignOrgDto } from "./dto/assign-org.dto";
import { CompleteRegistrationDto } from "./dto/complete-registration.dto";
import { UserResponseDto } from "./dto/user-response.dto";
import { UserWithOrgRolesDto } from "./dto/user-with-org-roles.dto";
import { UserOrgRoleResponseDto } from "./dto/user-org-role-response.dto";
import { SetSuperAdminDto } from "./dto/super-admin.dto";
import { RequireSuperAdmin } from "../common/decorators/require-super-admin.decorator";
import { CurrentUserId } from "../common/decorators/current-user-id.decorator";
import { PermissionsGuard } from "../common/guards/permissions.guard";
import { RequirePermission } from "../common/decorators/require-permission.decorator";
import { PermissionModule, PermissionAction } from "../roles/entities/permission.entity";

@Controller("api/users")
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async create(@Body() dto: CreateUserDto) {
    const { user, invitationToken } = await this.usersService.create(dto);
    return { ...UserResponseDto.from(user), invitationToken };
  }

  @Get()
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findAll(): Promise<UserResponseDto[]> {
    return (await this.usersService.findAll()).map(UserResponseDto.from);
  }

  @Get("super-admins")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findAllSuperAdmin(): Promise<UserResponseDto[]> {
    return (await this.usersService.findAllSuperAdmin()).map(UserResponseDto.from);
  }

  @Get("by-email/:email")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findByEmail(@Param("email") email: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.findByEmail(email));
  }

  @Get('by-org/:orgId')
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findByOrg(
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ): Promise<UserWithOrgRolesDto[]> {
    return (await this.usersService.findByOrg(orgId)).map(({ user, roles }) =>
      UserWithOrgRolesDto.fromUserAndRoles(user, roles),
    );
  }

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

  @Get(":id")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async findOne(@Param("id") id: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.findOne(id));
  }

  @Patch(":id")
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.update(id, dto));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionModule.USERS, PermissionAction.DELETE)
  remove(@Param("id") id: string) {
    return this.usersService.remove(id);
  }

  @Post(":id/restore")
  @RequirePermission(PermissionModule.USERS, PermissionAction.WRITE)
  async restore(@Param("id") id: string): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.restore(id));
  }

  @Post("complete-registration")
  async completeRegistration(@Body() dto: CompleteRegistrationDto): Promise<UserResponseDto> {
    return this.usersService.completeRegistration(dto);
  }

  @Post(":id/provision")
  provision(@Param("id") id: string, @Body() dto: ProvisionUserDto) {
    return this.usersService.provision(id, dto);
  }

  @Patch(":id/super-admin")
  async setSuperAdmin(
    @RequireSuperAdmin() _caller: void,
    @Param("id") id: string,
    @Body() dto: SetSuperAdminDto,
  ): Promise<UserResponseDto> {
    return UserResponseDto.from(await this.usersService.setSuperAdmin(id, dto.enabled));
  }

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

  @Get(":id/orgs")
  @RequirePermission(PermissionModule.USERS, PermissionAction.READ)
  async getOrgRoles(
    @Param("id") id: string,
  ): Promise<UserOrgRoleResponseDto[]> {
    return (await this.usersService.getOrgRoles(id)).map(UserOrgRoleResponseDto.from);
  }

  @Delete(":id/orgs/:orgId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionModule.USERS, PermissionAction.MANAGE)
  removeFromOrg(
    @Param("id") id: string,
    @Param("orgId") orgId: string,
  ): Promise<void> {
    return this.usersService.removeFromOrg(id, orgId);
  }
}

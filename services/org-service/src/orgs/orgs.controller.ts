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
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { CreateOrgDto } from './dto/create-org.dto';
import { UpdateOrgDto } from './dto/update-org.dto';
import { OrgResponseDto } from './dto/org-response.dto';
import { OrgGuard } from '../common/guards/org.guard';
import { SuperAdminOnly, OrgMemberOrSuperAdmin } from '../common/decorators/auth.decorator';

/** Extrae el userId del JWT sin verificar firma (Kong ya la verificó). */
function extractUserId(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(authHeader.split(' ')[1].split('.')[1], 'base64url').toString('utf8'),
    );
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

@Controller('api/org')
@UseGuards(OrgGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  /**
   * Crear una organización.
   * Solo super admin.
   */
  @Post()
  @SuperAdminOnly()
  async create(
    @Headers('authorization') auth: string,
    @Body() dto: CreateOrgDto,
  ): Promise<OrgResponseDto> {
    const createdBy = extractUserId(auth);
    return OrgResponseDto.from(await this.orgsService.create(dto, createdBy));
  }

  /**
   * Listar todas las organizaciones.
   * Solo super admin.
   */
  @Get()
  @SuperAdminOnly()
  async findAll(): Promise<OrgResponseDto[]> {
    return (await this.orgsService.findAll()).map(OrgResponseDto.from);
  }

  /**
   * Obtener una organización por ID.
   * Super admin, miembro de la org, o llamada interna (x-internal-token).
   */
  @Get(':id')
  @OrgMemberOrSuperAdmin()
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<OrgResponseDto> {
    return OrgResponseDto.from(await this.orgsService.findOne(id));
  }

  /**
   * Actualizar una organización.
   * Super admin o miembro de la org (para actualizar los datos de su propia org).
   */
  @Patch(':id')
  @OrgMemberOrSuperAdmin()
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateOrgDto,
  ): Promise<OrgResponseDto> {
    return OrgResponseDto.from(await this.orgsService.update(id, dto));
  }

  /**
   * Eliminar (soft delete) una organización.
   * Solo super admin.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @SuperAdminOnly()
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.orgsService.remove(id);
  }

  /**
   * Restaurar una organización eliminada.
   * Solo super admin.
   */
  @Post(':id/restore')
  @SuperAdminOnly()
  async restore(@Param('id', ParseUUIDPipe) id: string): Promise<OrgResponseDto> {
    return OrgResponseDto.from(await this.orgsService.restore(id));
  }
}

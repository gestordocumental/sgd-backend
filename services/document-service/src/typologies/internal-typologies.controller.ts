import {
  Controller,
  Get,
  Param,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { InternalGuard, AllowInternalTokens } from '@sgd/common';
import { TypologiesService } from './typologies.service';

@Controller('internal/typologies')
@UseGuards(InternalGuard)
@AllowInternalTokens('INTERNAL_TOKEN_WORKFLOW_DOC')
export class InternalTypologiesController {
  constructor(private readonly typologiesService: TypologiesService) {}

  @Get(':id/public-info')
  async getPublicInfo(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
  ) {
    if (!orgId) throw new BadRequestException('orgId query param is required');

    const doc = await this.typologiesService.findByIdPublic(orgId, id);

    return {
      id: (doc._id as { toString(): string }).toString(),
      nombre: doc.datosDeclarados.nombre,
      codigo: doc.datosDeclarados.codigo,
      version: doc.datosDeclarados.version,
      estructuraOrg: {
        departamentoId:    doc.estructuraOrg.departamentoId,
        departamentoNombre: doc.estructuraOrg.departamentoNombre,
        areaId:            doc.estructuraOrg.areaId,
        areaNombre:        doc.estructuraOrg.areaNombre,
        cargoId:           doc.estructuraOrg.cargoId,
        cargoNombre:       doc.estructuraOrg.cargoNombre,
      },
    };
  }
}

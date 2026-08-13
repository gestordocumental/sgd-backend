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
      reviewCycleEnabled: doc.reviewCycleEnabled ?? false,
    };
  }

  @Get(':id/review-cycle-enabled')
  async getReviewCycleEnabled(
    @Param('id') id: string,
    @Query('orgId') orgId: string,
  ) {
    if (!orgId) throw new BadRequestException('orgId query param is required');

    const doc = await this.typologiesService.findByIdPublic(orgId, id);

    return {
      id: (doc._id as { toString(): string }).toString(),
      reviewCycleEnabled: doc.reviewCycleEnabled ?? false,
    };
  }

  // Called by org-service before deleting a departamento/area/cargo, to block
  // the delete if a typology still references it — a separate token
  // (INTERNAL_TOKEN_ORG_DOC) from the class-level one, since org-service is a
  // distinct caller from workflow-service.
  @Get('org-structure-references')
  @AllowInternalTokens('INTERNAL_TOKEN_ORG_DOC')
  async getOrgStructureReferences(
    @Query('orgId') orgId: string,
    @Query('departamentoId') departamentoId?: string,
    @Query('areaId') areaId?: string,
    @Query('cargoId') cargoId?: string,
  ) {
    if (!orgId) throw new BadRequestException('orgId query param is required');

    // Excludes '' along with undefined — an empty query param (e.g.
    // ?departamentoId=) must count as "not provided", not as a real filter
    // value. Otherwise it silently passes this check but then gets dropped
    // by countOrgStructureReferences()'s own `if (filters.departamentoId)`
    // guard (empty string is falsy), leaving the Mongo filter scoped only
    // to { orgId, deletedAt: null } — an org-wide count masquerading as a
    // reference count for one specific structure node.
    const provided = [departamentoId, areaId, cargoId].filter((v) => v !== undefined && v !== '');
    if (provided.length !== 1) {
      throw new BadRequestException(
        'Exactly one of departamentoId, areaId, or cargoId query params is required',
      );
    }

    const count = await this.typologiesService.countOrgStructureReferences(orgId, {
      departamentoId,
      areaId,
      cargoId,
    });
    return { count };
  }
}

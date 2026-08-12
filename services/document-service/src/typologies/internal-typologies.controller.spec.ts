import { BadRequestException } from '@nestjs/common';
import { INTERNAL_TOKEN_KEYS_META } from '@sgd/common';
import { InternalTypologiesController } from './internal-typologies.controller';
import { TypologyStatus, DataSource, CreationSource, ExtractionStatus } from './schemas/typology.schema';
import type { TypologyDocument } from './schemas/typology.schema';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDoc(overrides: Record<string, any> = {}): TypologyDocument {
  return {
    _id: { toString: () => 'typo-id-1' },
    orgId: 'org-1',
    typologyStatus: TypologyStatus.ACTIVE,
    estructuraOrg: {
      departamentoId: 'dept-1', departamentoNombre: 'IT',
      areaId: null, areaNombre: null, cargoId: null, cargoNombre: null,
    },
    datosDeclarados: { nombre: 'Policy', codigo: 'POL-001', version: '01', fuente: DataSource.MANUAL },
    documento: {
      r2Key: null, originalName: null, mimeType: null, uploadedAt: null,
      extractionStatus: ExtractionStatus.NOT_UPLOADED,
    },
    metadataExtraida: { nombre: null, codigo: null, version: null, extractedAt: null, discrepancias: [] },
    fuenteCreacion: CreationSource.MANUAL,
    deletedAt: null,
    reviewCycleEnabled: false,
    ...overrides,
  } as unknown as TypologyDocument;
}

function makeService() {
  return {
    findByIdPublic: jest.fn().mockResolvedValue(makeDoc()),
    countOrgStructureReferences: jest.fn().mockResolvedValue(0),
  };
}

describe('InternalTypologiesController', () => {
  let service: ReturnType<typeof makeService>;
  let controller: InternalTypologiesController;

  beforeEach(() => {
    service = makeService();
    controller = new InternalTypologiesController(service as any);
  });

  describe('getPublicInfo()', () => {
    it('throws BadRequestException when orgId is missing', async () => {
      await expect(controller.getPublicInfo('typo-1', '')).rejects.toThrow(BadRequestException);
    });

    it('returns the typology public info', async () => {
      const result = await controller.getPublicInfo('typo-1', 'org-1');

      expect(service.findByIdPublic).toHaveBeenCalledWith('org-1', 'typo-1');
      expect(result).toMatchObject({ id: 'typo-id-1', nombre: 'Policy' });
    });
  });

  describe('getReviewCycleEnabled()', () => {
    it('throws BadRequestException when orgId is missing', async () => {
      await expect(controller.getReviewCycleEnabled('typo-1', '')).rejects.toThrow(BadRequestException);
    });

    it('returns the reviewCycleEnabled flag', async () => {
      const result = await controller.getReviewCycleEnabled('typo-1', 'org-1');

      expect(result).toEqual({ id: 'typo-id-1', reviewCycleEnabled: false });
    });
  });

  describe('getOrgStructureReferences()', () => {
    it('is restricted to INTERNAL_TOKEN_ORG_DOC — kept separate from the class-level token', () => {
      const keys = (Reflect.getMetadata(
        INTERNAL_TOKEN_KEYS_META,
        InternalTypologiesController.prototype.getOrgStructureReferences,
      ) ?? []) as string[];
      expect(keys).toEqual(['INTERNAL_TOKEN_ORG_DOC']);
    });

    it('throws BadRequestException when orgId is missing', async () => {
      await expect(
        controller.getOrgStructureReferences('', undefined, undefined, 'cargo-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when no filter is given', async () => {
      await expect(
        controller.getOrgStructureReferences('org-1', undefined, undefined, undefined),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when more than one filter is given', async () => {
      await expect(
        controller.getOrgStructureReferences('org-1', 'dept-1', 'area-1', undefined),
      ).rejects.toThrow(BadRequestException);
    });

    // Regression: an empty string used to pass the "exactly one" check
    // (only undefined was excluded), then get silently dropped by
    // countOrgStructureReferences()'s own falsy check — leaving the query
    // scoped to nothing but { orgId, deletedAt: null }, an org-wide count
    // masquerading as a reference count for one specific node.
    it('throws BadRequestException when the only filter given is an empty string', async () => {
      await expect(
        controller.getOrgStructureReferences('org-1', '', undefined, undefined),
      ).rejects.toThrow(BadRequestException);
      expect(service.countOrgStructureReferences).not.toHaveBeenCalled();
    });

    it('ignores an empty-string filter alongside a real one instead of treating it as "two filters given"', async () => {
      service.countOrgStructureReferences.mockResolvedValue(1);

      const result = await controller.getOrgStructureReferences('org-1', 'dept-1', '', undefined);

      expect(service.countOrgStructureReferences).toHaveBeenCalledWith('org-1', {
        departamentoId: 'dept-1',
        areaId: '',
        cargoId: undefined,
      });
      expect(result).toEqual({ count: 1 });
    });

    it('returns the count for a cargoId filter', async () => {
      service.countOrgStructureReferences.mockResolvedValue(2);

      const result = await controller.getOrgStructureReferences('org-1', undefined, undefined, 'cargo-1');

      expect(service.countOrgStructureReferences).toHaveBeenCalledWith('org-1', {
        departamentoId: undefined,
        areaId: undefined,
        cargoId: 'cargo-1',
      });
      expect(result).toEqual({ count: 2 });
    });
  });
});

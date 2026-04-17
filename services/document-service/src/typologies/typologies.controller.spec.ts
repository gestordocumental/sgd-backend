import { BadRequestException } from '@nestjs/common';
import { TypologiesController } from './typologies.controller';
import {
  CreationSource,
  DataSource,
  ExtractionStatus,
  TypologyStatus,
} from './schemas/typology.schema';
import { ResolveAction } from './dto/resolve-discrepancy.dto';
import { TypologyResponseDto } from './dto/typology-response.dto';
import type { TypologyDocument } from './schemas/typology.schema';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeDoc(overrides: Record<string, any> = {}): TypologyDocument {
  return {
    id:             'typo-id-1',
    orgId:          'org-1',
    typologyStatus: TypologyStatus.ACTIVE,
    estructuraOrg: {
      departamentoId: 'dept-1', departamentoNombre: 'IT',
      areaId: null, areaNombre: null, cargoId: null, cargoNombre: null,
    },
    datosDeclarados: {
      nombre: 'Policy', codigo: 'POL-001', version: '01', fuente: DataSource.MANUAL,
    },
    documento: {
      r2Key: null, originalName: null, mimeType: null, uploadedAt: null,
      extractionStatus: ExtractionStatus.NOT_UPLOADED,
    },
    metadataExtraida: {
      nombre: null, codigo: null, version: null, extractedAt: null, discrepancias: [],
    },
    fuenteCreacion: CreationSource.MANUAL,
    deletedAt:      null,
    createdAt:      new Date(),
    updatedAt:      new Date(),
    save:           jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TypologyDocument;
}

function makeDeps(docOrNull: TypologyDocument | null = null) {
  const doc = docOrNull ?? makeDoc();
  const service = {
    create:              jest.fn().mockResolvedValue(doc),
    findAll:             jest.fn().mockResolvedValue([doc]),
    findOne:             jest.fn().mockResolvedValue(doc),
    findHistory:         jest.fn().mockResolvedValue([doc]),
    update:              jest.fn().mockResolvedValue(doc),
    remove:              jest.fn().mockResolvedValue(undefined),
    resolveDiscrepancy:  jest.fn().mockResolvedValue(doc),
  };
  const orgClient = {
    resolveStructureById: jest.fn().mockResolvedValue({
      departamentoId: 'dept-1', departamentoNombre: 'IT',
      areaId: null, areaNombre: null, cargoId: null, cargoNombre: null,
    }),
  };
  const extractorClient = {
    previewExtract: jest.fn().mockResolvedValue({ nombre: 'Policy', codigo: 'POL-001', version: '01' }),
  };
  return { service, orgClient, extractorClient };
}

// ── TypologiesController ───────────────────────────────────────────────────

describe('TypologiesController', () => {
  describe('previewExtract()', () => {
    it('delegates to extractorClient', async () => {
      const { service, orgClient, extractorClient } = makeDeps();
      const ctrl = new TypologiesController(service as any, orgClient as any, extractorClient as any);

      const file = { buffer: Buffer.from(''), mimetype: 'application/pdf' } as Express.Multer.File;
      const result = await ctrl.previewExtract(file, {}, 'Helisa SAS');

      expect(extractorClient.previewExtract).toHaveBeenCalledWith(file, 'Helisa SAS');
      expect(result).toEqual({ nombre: 'Policy', codigo: 'POL-001', version: '01' });
    });

    it('throws BadRequestException when no file is provided', async () => {
      const { service, orgClient, extractorClient } = makeDeps();
      const ctrl = new TypologiesController(service as any, orgClient as any, extractorClient as any);

      await expect(ctrl.previewExtract(undefined as any, {})).rejects.toThrow(BadRequestException);
    });
  });

  describe('create()', () => {
    it('resolves org structure and creates a typology', async () => {
      const { service, orgClient, extractorClient } = makeDeps();
      const ctrl = new TypologiesController(service as any, orgClient as any, extractorClient as any);

      const result = await ctrl.create('org-1', {
        departamentoId: 'dept-1',
        nombre: 'Policy', codigo: 'POL-001', version: '01',
      });

      expect(orgClient.resolveStructureById).toHaveBeenCalledWith('org-1', 'dept-1', undefined, undefined);
      expect(service.create).toHaveBeenCalledWith(
        'org-1',
        expect.any(Object),
        expect.objectContaining({ departamentoId: 'dept-1' }),
        CreationSource.MANUAL,
      );
      expect(result).toBeInstanceOf(TypologyResponseDto);
    });
  });

  describe('findAll()', () => {
    it('returns array of TypologyResponseDto', async () => {
      const { service, orgClient, extractorClient } = makeDeps();
      const ctrl = new TypologiesController(service as any, orgClient as any, extractorClient as any);

      const result = await ctrl.findAll('org-1', 1, 20);

      expect(service.findAll).toHaveBeenCalledWith('org-1', 1, 20);
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(TypologyResponseDto);
    });

    it('caps limit at 100', async () => {
      const { service, orgClient, extractorClient } = makeDeps();
      const ctrl = new TypologiesController(service as any, orgClient as any, extractorClient as any);

      await ctrl.findAll('org-1', 1, 500);

      expect(service.findAll).toHaveBeenCalledWith('org-1', 1, 100);
    });
  });

  describe('findHistory()', () => {
    it('delegates to service and returns TypologyResponseDto[]', async () => {
      const { service, orgClient, extractorClient } = makeDeps();
      const ctrl = new TypologiesController(service as any, orgClient as any, extractorClient as any);

      const result = await ctrl.findHistory('org-1', 'POL-001');

      expect(service.findHistory).toHaveBeenCalledWith('org-1', 'POL-001');
      expect(result[0]).toBeInstanceOf(TypologyResponseDto);
    });
  });

  describe('findOne()', () => {
    it('returns TypologyResponseDto', async () => {
      const { service, orgClient, extractorClient } = makeDeps();
      const ctrl = new TypologiesController(service as any, orgClient as any, extractorClient as any);

      const result = await ctrl.findOne('org-1', 'typo-id-1');

      expect(service.findOne).toHaveBeenCalledWith('org-1', 'typo-id-1');
      expect(result).toBeInstanceOf(TypologyResponseDto);
    });
  });

  describe('update()', () => {
    it('delegates to service', async () => {
      const { service, orgClient, extractorClient } = makeDeps();
      const ctrl = new TypologiesController(service as any, orgClient as any, extractorClient as any);

      const result = await ctrl.update('org-1', 'typo-id-1', { nombre: 'Updated' });

      expect(service.update).toHaveBeenCalledWith('org-1', 'typo-id-1', { nombre: 'Updated' }, undefined);
      expect(result).toBeInstanceOf(TypologyResponseDto);
    });
  });

  describe('remove()', () => {
    it('calls service.remove and returns void', async () => {
      const { service, orgClient, extractorClient } = makeDeps();
      const ctrl = new TypologiesController(service as any, orgClient as any, extractorClient as any);

      await ctrl.remove('org-1', 'typo-id-1');

      expect(service.remove).toHaveBeenCalledWith('org-1', 'typo-id-1');
    });
  });

  describe('resolveDiscrepancy()', () => {
    it('delegates to service', async () => {
      const { service, orgClient, extractorClient } = makeDeps();
      const ctrl = new TypologiesController(service as any, orgClient as any, extractorClient as any);

      const result = await ctrl.resolveDiscrepancy('org-1', 'typo-id-1', { action: ResolveAction.KEEP_DECLARED });

      expect(service.resolveDiscrepancy).toHaveBeenCalledWith('org-1', 'typo-id-1', { action: ResolveAction.KEEP_DECLARED });
      expect(result).toBeInstanceOf(TypologyResponseDto);
    });
  });
});

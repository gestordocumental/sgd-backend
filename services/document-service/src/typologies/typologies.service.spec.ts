import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { TypologiesService } from './typologies.service';
import {
  CreationSource,
  DataSource,
  ExtractionStatus,
  TypologyStatus,
} from './schemas/typology.schema';
import { ResolveAction } from './dto/resolve-discrepancy.dto';
import type { TypologyDocument } from './schemas/typology.schema';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeId() {
  return new Types.ObjectId().toString();
}

const STRUCTURE_NAMES = {
  departamentoId:    'dept-1',
  departamentoNombre: 'IT',
  areaId:             null,
  areaNombre:         null,
  cargoId:            null,
  cargoNombre:        null,
};

function makeDoc(overrides: Record<string, any> = {}): TypologyDocument {
  return {
    id:             makeId(),
    orgId:          'org-1',
    typologyStatus: TypologyStatus.ACTIVE,
    estructuraOrg: { ...STRUCTURE_NAMES },
    datosDeclarados: {
      nombre:  'Policy',
      codigo:  'POL-001',
      version: '01',
      fuente:  DataSource.MANUAL,
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
    save:           jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TypologyDocument;
}

function makeModel(docOrNull: TypologyDocument | null = null) {
  const instance = docOrNull ?? makeDoc();
  const Model: any = jest.fn().mockReturnValue(instance);
  Model.findOne  = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(docOrNull) });
  Model.find     = jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) });
  Model.updateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });
  return { Model, instance };
}

let mockKafkaProducer: { send: jest.Mock };

// ── TypologiesService ──────────────────────────────────────────────────────

describe('TypologiesService', () => {
  beforeEach(() => {
    mockKafkaProducer = { send: jest.fn().mockResolvedValue(undefined) };
  });

  const makeService = (Model: any): TypologiesService => new TypologiesService(Model, mockKafkaProducer as any);
  // ── create ───────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('creates an ACTIVE typology when all fields are present', async () => {
      const { Model, instance } = makeModel();
      // No existing active typology
      Model.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      instance.save = jest.fn().mockResolvedValue(instance);

      const service = makeService(Model);
      const result = await service.create(
        'org-1',
        { departamentoId: 'dept-1', nombre: 'Policy', codigo: 'POL-001', version: '01' },
        STRUCTURE_NAMES,
      );

      expect(instance.save).toHaveBeenCalled();
      expect(result).toBe(instance);
    });

    it('creates INCOMPLETE typology when some fields are missing', async () => {
      const { Model, instance } = makeModel();
      Model.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      instance.typologyStatus = TypologyStatus.INCOMPLETE;
      instance.save = jest.fn().mockResolvedValue(instance);

      const service = makeService(Model);
      await service.create(
        'org-1',
        { departamentoId: 'dept-1' }, // no nombre/codigo/version
        STRUCTURE_NAMES,
      );

      expect(instance.save).toHaveBeenCalled();
    });

    it('throws ConflictException when an ACTIVE typology with the same codigo already exists', async () => {
      const { Model } = makeModel(makeDoc());
      // Pre-check returns an existing active typology
      Model.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(makeDoc()) });

      const service = makeService(Model);
      await expect(
        service.create(
          'org-1',
          { departamentoId: 'dept-1', codigo: 'POL-001' },
          STRUCTURE_NAMES,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('translates mongo duplicate-key error (11000) to ConflictException', async () => {
      const { Model, instance } = makeModel();
      Model.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      const dupErr: any = new Error('dup key');
      dupErr.code = 11000;
      instance.save = jest.fn().mockRejectedValue(dupErr);

      const service = makeService(Model);
      await expect(
        service.create('org-1', { departamentoId: 'dept-1', codigo: 'POL-001' }, STRUCTURE_NAMES),
      ).rejects.toThrow(ConflictException);
    });

    it('re-throws unexpected errors from save()', async () => {
      const { Model, instance } = makeModel();
      Model.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) });
      instance.save = jest.fn().mockRejectedValue(new Error('DB connection lost'));

      const service = makeService(Model);
      await expect(
        service.create('org-1', { departamentoId: 'dept-1' }, STRUCTURE_NAMES),
      ).rejects.toThrow('DB connection lost');
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────────

  describe('findAll()', () => {
    it('queries only ACTIVE typologies with correct pagination', async () => {
      const docs = [makeDoc(), makeDoc()];
      const execMock = jest.fn().mockResolvedValue(docs);
      const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: execMock };
      const { Model } = makeModel();
      Model.find = jest.fn().mockReturnValue(chain);

      const service = makeService(Model);
      const result = await service.findAll('org-1', 2, 10);

      expect(Model.find).toHaveBeenCalledWith({ orgId: 'org-1', typologyStatus: TypologyStatus.ACTIVE });
      expect(chain.skip).toHaveBeenCalledWith(10); // page=2, limit=10 → skip=10
      expect(chain.limit).toHaveBeenCalledWith(10);
      expect(result).toEqual(docs);
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────────

  describe('findOne()', () => {
    it('returns a typology by ID', async () => {
      const doc = makeDoc();
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      const result = await service.findOne('org-1', doc.id);

      expect(result).toBe(doc);
    });

    it('throws BadRequestException for invalid ObjectId', async () => {
      const { Model } = makeModel();
      const service = makeService(Model);

      await expect(service.findOne('org-1', 'not-an-id')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when typology does not exist', async () => {
      const { Model } = makeModel();
      Model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const service = makeService(Model);
      const validId = makeId();
      await expect(service.findOne('org-1', validId)).rejects.toThrow(NotFoundException);
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates declared data fields', async () => {
      const doc = makeDoc();
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await service.update('org-1', doc.id, { nombre: 'New Name' });

      expect(doc.datosDeclarados.nombre).toBe('New Name');
      expect(doc.save).toHaveBeenCalled();
    });

    it('allows valid version increment (01 → 02)', async () => {
      const doc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'C', version: '01', fuente: DataSource.MANUAL } });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(service.update('org-1', doc.id, { version: '02' })).resolves.not.toThrow();
      expect(doc.datosDeclarados.version).toBe('02');
    });

    it('allows valid semver increment (v1.0 → v1.1)', async () => {
      const doc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'C', version: 'v1.0', fuente: DataSource.MANUAL } });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(service.update('org-1', doc.id, { version: 'v1.1' })).resolves.not.toThrow();
    });

    it('rejects version jump of more than one (01 → 03)', async () => {
      const doc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'C', version: '01', fuente: DataSource.MANUAL } });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(service.update('org-1', doc.id, { version: '03' })).rejects.toThrow(BadRequestException);
    });

    it('allows same version (01 → 01)', async () => {
      const doc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'C', version: '01', fuente: DataSource.MANUAL } });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(service.update('org-1', doc.id, { version: '01' })).resolves.not.toThrow();
      expect(doc.datosDeclarados.version).toBe('01');
    });

    it('rejects decremented version (02 → 01)', async () => {
      const doc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'C', version: '02', fuente: DataSource.MANUAL } });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(service.update('org-1', doc.id, { version: '01' })).rejects.toThrow(BadRequestException);
    });

    it('rejects v1.0 → v2.1 (skips minor reset)', async () => {
      const doc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'C', version: 'v1.0', fuente: DataSource.MANUAL } });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(service.update('org-1', doc.id, { version: 'v2.1' })).rejects.toThrow(BadRequestException);
    });

    it('allows version when no previous version is set', async () => {
      const doc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'C', version: null, fuente: DataSource.MANUAL } });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(service.update('org-1', doc.id, { version: '05' })).resolves.not.toThrow();
    });

    it('translates mongo 11000 to ConflictException', async () => {
      const doc = makeDoc();
      const { Model } = makeModel(doc);
      const dupErr: any = new Error('dup');
      dupErr.code = 11000;
      (doc.save as jest.Mock).mockRejectedValue(dupErr);

      const service = makeService(Model);
      await expect(service.update('org-1', doc.id, { nombre: 'X' })).rejects.toThrow(ConflictException);
    });
  });

  // ── remove ────────────────────────────────────────────────────────────────

  describe('remove()', () => {
    it('sets deletedAt and typologyStatus = DELETED', async () => {
      const doc = makeDoc();
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await service.remove('org-1', doc.id);

      expect(doc.deletedAt).toBeInstanceOf(Date);
      expect(doc.typologyStatus).toBe(TypologyStatus.DELETED);
      expect(doc.save).toHaveBeenCalled();
    });
  });

  // ── findHistory ───────────────────────────────────────────────────────────

  describe('findHistory()', () => {
    it('returns all typologies with the same codigo (including deleted)', async () => {
      const docs = [makeDoc(), makeDoc({ deletedAt: new Date() })];
      const chain = { sort: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(docs) };
      const { Model } = makeModel();
      Model.find = jest.fn().mockReturnValue(chain);

      const service = makeService(Model);
      const result = await service.findHistory('org-1', 'POL-001');

      expect(Model.find).toHaveBeenCalledWith({ orgId: 'org-1', 'datosDeclarados.codigo': 'POL-001' });
      expect(result).toHaveLength(2);
    });
  });

  // ── applyExtractedMetadata ────────────────────────────────────────────────

  describe('applyExtractedMetadata()', () => {
    it('scenario A — sets DISCREPANCY when extracted data differs from declared', async () => {
      const doc = makeDoc({
        datosDeclarados: { nombre: 'Policy', codigo: 'POL-001', version: '01', fuente: DataSource.MANUAL },
      });
      const { Model } = makeModel(doc);
      Model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      const service = makeService(Model);
      await service.applyExtractedMetadata('org-1', doc.id, {
        nombre: 'Different Name', codigo: 'POL-001', version: '01',
      });

      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.DISCREPANCY);
      expect(doc.metadataExtraida.discrepancias).toHaveLength(1);
      expect(doc.metadataExtraida.discrepancias[0].campo).toBe('nombre');
    });

    it('scenario A — sets COMPLETED when extracted data matches declared', async () => {
      const doc = makeDoc({
        datosDeclarados: { nombre: 'Policy', codigo: 'POL-001', version: '01', fuente: DataSource.MANUAL },
      });
      const { Model } = makeModel(doc);
      Model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      const service = makeService(Model);
      await service.applyExtractedMetadata('org-1', doc.id, {
        nombre: 'Policy', codigo: 'POL-001', version: '01',
      });

      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.COMPLETED);
      expect(doc.metadataExtraida.discrepancias).toHaveLength(0);
    });

    it('scenario B — sets PENDING_CONFIRMATION when no declared data', async () => {
      const doc = makeDoc({
        datosDeclarados: { nombre: null, codigo: null, version: null, fuente: DataSource.MANUAL },
      });
      const { Model } = makeModel(doc);
      Model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      const service = makeService(Model);
      await service.applyExtractedMetadata('org-1', doc.id, {
        nombre: 'Extracted', codigo: 'EXT-001', version: 'v1.0',
      });

      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.PENDING_CONFIRMATION);
    });

    it('does nothing if typology is not found (already deleted)', async () => {
      const { Model } = makeModel();
      Model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const service = makeService(Model);
      // Should not throw
      await expect(
        service.applyExtractedMetadata('org-1', makeId(), { nombre: 'X', codigo: null, version: null }),
      ).resolves.toBeUndefined();
    });
  });

  // ── markExtractionFailed ──────────────────────────────────────────────────

  describe('markExtractionFailed()', () => {
    it('updates extraction status to FAILED', async () => {
      const id = makeId();
      const { Model } = makeModel();

      const service = makeService(Model);
      await service.markExtractionFailed('org-1', id, 'parse error');

      expect(Model.updateOne).toHaveBeenCalledWith(
        { _id: id, orgId: 'org-1', deletedAt: null },
        { $set: { 'documento.extractionStatus': ExtractionStatus.FAILED } },
      );
    });

    it('does nothing for invalid ObjectId', async () => {
      const { Model } = makeModel();
      const service = makeService(Model);

      await expect(service.markExtractionFailed('org-1', 'bad-id', 'err')).resolves.toBeUndefined();
      expect(Model.updateOne).not.toHaveBeenCalled();
    });
  });

  // ── resolveDiscrepancy ────────────────────────────────────────────────────

  describe('resolveDiscrepancy()', () => {
    it('KEEP_DECLARED — does not change datosDeclarados', async () => {
      const doc = makeDoc({
        documento: { extractionStatus: ExtractionStatus.DISCREPANCY, r2Key: null, originalName: null, mimeType: null, uploadedAt: null },
        metadataExtraida: { nombre: 'Other', codigo: 'POL-001', version: '01', extractedAt: new Date(), discrepancias: [] },
      });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await service.resolveDiscrepancy('org-1', doc.id, { action: ResolveAction.KEEP_DECLARED });

      expect(doc.datosDeclarados.nombre).toBe('Policy');
      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.CONFIRMED);
    });

    it('ADOPT_EXTRACTED — copies extracted values to datosDeclarados', async () => {
      const doc = makeDoc({
        documento: { extractionStatus: ExtractionStatus.PENDING_CONFIRMATION, r2Key: null, originalName: null, mimeType: null, uploadedAt: null },
        metadataExtraida: { nombre: 'Extracted', codigo: 'EXT-001', version: 'v2.0', extractedAt: new Date(), discrepancias: [] },
      });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await service.resolveDiscrepancy('org-1', doc.id, { action: ResolveAction.ADOPT_EXTRACTED });

      expect(doc.datosDeclarados.nombre).toBe('Extracted');
      expect(doc.datosDeclarados.codigo).toBe('EXT-001');
      expect(doc.datosDeclarados.fuente).toBe(DataSource.CONFIRMED_FROM_EXTRACTION);
    });

    it('MANUAL_OVERRIDE — uses provided values', async () => {
      const doc = makeDoc({
        documento: { extractionStatus: ExtractionStatus.DISCREPANCY, r2Key: null, originalName: null, mimeType: null, uploadedAt: null },
      });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await service.resolveDiscrepancy('org-1', doc.id, {
        action: ResolveAction.MANUAL_OVERRIDE,
        nombre: 'Manual Name',
        version: '03',
      });

      expect(doc.datosDeclarados.nombre).toBe('Manual Name');
      expect(doc.datosDeclarados.version).toBe('03');
    });

    it('throws BadRequestException when extraction status is not DISCREPANCY or PENDING_CONFIRMATION', async () => {
      const doc = makeDoc({
        documento: { extractionStatus: ExtractionStatus.COMPLETED, r2Key: null, originalName: null, mimeType: null, uploadedAt: null },
      });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(
        service.resolveDiscrepancy('org-1', doc.id, { action: ResolveAction.KEEP_DECLARED }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

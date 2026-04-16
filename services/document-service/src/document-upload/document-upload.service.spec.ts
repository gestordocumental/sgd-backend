import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { DocumentUploadService } from './document-upload.service';
import {
  CreationSource,
  DataSource,
  ExtractionStatus,
  TypologyStatus,
} from '../typologies/schemas/typology.schema';
import type { TypologyDocument } from '../typologies/schemas/typology.schema';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeId() {
  return new Types.ObjectId().toString();
}

const PDF_MIME  = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname:    'file',
    originalname: 'test.pdf',
    encoding:     '7bit',
    mimetype:     PDF_MIME,
    size:         1024,
    buffer:       Buffer.from('fake pdf content'),
    destination:  '',
    filename:     '',
    path:         '',
    stream:       null as any,
    ...overrides,
  };
}

function makeDoc(overrides: Record<string, any> = {}): TypologyDocument {
  return {
    id:             makeId(),
    _id:            new Types.ObjectId(),
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
    save:           jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as TypologyDocument;
}

function makeDeps(doc: TypologyDocument | null = null) {
  const model: any = {
    findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
  };
  const storage = {
    upload:              jest.fn().mockResolvedValue(undefined),
    delete:              jest.fn().mockResolvedValue(undefined),
    getSignedDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://signed.url', expiresAt: new Date() }),
  };
  const kafka  = { emit: jest.fn().mockResolvedValue(undefined) };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { model, storage, kafka, logger };
}

// ── DocumentUploadService ──────────────────────────────────────────────────

describe('DocumentUploadService', () => {

  // ── upload() ──────────────────────────────────────────────────────────────

  describe('upload()', () => {
    it('uploads a valid PDF and emits Kafka event', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      const result = await service.upload('org-1', doc.id, makeFile());

      expect(storage.upload).toHaveBeenCalled();
      expect(kafka.emit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ orgId: 'org-1', typologyId: doc.id }),
      );
      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.PROCESSING);
      expect(result.extractionStatus).toBe(ExtractionStatus.PROCESSING);
    });

    it('passes orgName to Kafka payload when provided', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await service.upload('org-1', doc.id, makeFile(), 'Helisa SAS');

      expect(kafka.emit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ orgName: 'Helisa SAS' }),
      );
    });

    it('deletes previous file when one already exists', async () => {
      const doc = makeDoc({
        documento: { r2Key: 'org/org-1/typologies/old-file.pdf', extractionStatus: ExtractionStatus.COMPLETED, originalName: 'old.pdf', mimeType: PDF_MIME, uploadedAt: new Date() },
      });
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await service.upload('org-1', doc.id, makeFile());

      expect(storage.delete).toHaveBeenCalledWith('org/org-1/typologies/old-file.pdf');
    });

    it('throws BadRequestException for unsupported MIME type', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(
        service.upload('org-1', doc.id, makeFile({ mimetype: 'image/jpeg' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when file exceeds 20 MB', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(
        service.upload('org-1', doc.id, makeFile({ size: 21 * 1024 * 1024 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid typology ID', async () => {
      const { model, storage, kafka, logger } = makeDeps();
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(
        service.upload('org-1', 'not-an-id', makeFile()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when typology does not exist', async () => {
      const { model, storage, kafka, logger } = makeDeps(null);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(
        service.upload('org-1', makeId(), makeFile()),
      ).rejects.toThrow(NotFoundException);
    });

    it('accepts DOCX files', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(
        service.upload('org-1', doc.id, makeFile({ mimetype: DOCX_MIME, originalname: 'test.docx' })),
      ).resolves.not.toThrow();
    });
  });

  // ── createNewVersion() ────────────────────────────────────────────────────

  describe('createNewVersion()', () => {
    it('archives the old typology and creates a new one', async () => {
      const oldDoc = makeDoc();
      const newDoc = makeDoc({ id: makeId() });

      const model: any = {
        findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) }),
      };
      // Constructor call returns newDoc
      const ModelConstructor: any = jest.fn().mockReturnValue(newDoc);
      Object.assign(model, ModelConstructor);
      model.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      // Simulate model as constructor + static methods
      const FullModel: any = function () { return newDoc; };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = {
        upload: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      };
      const kafka  = { emit: jest.fn().mockResolvedValue(undefined) };
      const logger = { log: jest.fn(), warn: jest.fn() };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any);
      await service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' });

      expect(oldDoc.typologyStatus).toBe(TypologyStatus.ARCHIVED);
      expect(oldDoc.save).toHaveBeenCalled();
      expect(storage.upload).toHaveBeenCalled();
      expect(kafka.emit).toHaveBeenCalled();
    });

    it('throws BadRequestException for version that is not exactly one increment', async () => {
      const oldDoc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'C', version: '01', fuente: DataSource.MANUAL } });
      const FullModel: any = function () { return makeDoc(); };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn(), delete: jest.fn() };
      const kafka   = { emit: jest.fn() };
      const logger  = { log: jest.fn() };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any);
      await expect(
        service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '05' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for unsupported MIME', async () => {
      const oldDoc = makeDoc();
      const FullModel: any = function () { return makeDoc(); };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn(), delete: jest.fn() };
      const kafka   = { emit: jest.fn() };
      const logger  = { log: jest.fn() };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any);
      await expect(
        service.createNewVersion('org-1', oldDoc.id, makeFile({ mimetype: 'text/plain' }), {}),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when old typology does not exist', async () => {
      const FullModel: any = function () { return makeDoc(); };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const storage = { upload: jest.fn() };
      const kafka   = { emit: jest.fn() };
      const logger  = { log: jest.fn() };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any);
      await expect(
        service.createNewVersion('org-1', makeId(), makeFile(), {}),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getSignedUrl() ────────────────────────────────────────────────────────

  describe('getSignedUrl()', () => {
    it('returns signed URL for typology with uploaded document', async () => {
      const doc = makeDoc({
        documento: { r2Key: 'org/org-1/typologies/file.pdf', extractionStatus: ExtractionStatus.COMPLETED, originalName: 'file.pdf', mimeType: PDF_MIME, uploadedAt: new Date() },
      });
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      const result = await service.getSignedUrl('org-1', doc.id);

      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('org/org-1/typologies/file.pdf', 'file.pdf', 'application/pdf');
      expect(result.signedUrl).toBe('https://signed.url');
    });

    it('throws NotFoundException when typology has no document', async () => {
      const doc = makeDoc(); // no r2Key
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(service.getSignedUrl('org-1', doc.id)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for invalid ID', async () => {
      const { model, storage, kafka, logger } = makeDeps();
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(service.getSignedUrl('org-1', 'bad')).rejects.toThrow(BadRequestException);
    });
  });
});

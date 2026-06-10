import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
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

// Minimal 2-entry ZIP buffers for DOCX and XLSX. validateMagicBytes() now requires both
// the [Content_Types].xml first-entry and a type-specific part entry, so each format needs
// its own buffer — DOCX requires word/document.xml, XLSX requires xl/workbook.xml.
function makeOoxmlEntry(filename: string): Buffer {
  const name = Buffer.from(filename);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name]);
}
const DOCX_MAGIC = Buffer.concat([
  makeOoxmlEntry('[Content_Types].xml'),
  makeOoxmlEntry('word/document.xml'),
]);
const XLSX_MAGIC = Buffer.concat([
  makeOoxmlEntry('[Content_Types].xml'),
  makeOoxmlEntry('xl/workbook.xml'),
]);

// Minimum valid magic bytes per MIME type so validateMagicBytes() passes in tests.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAGIC_BYTES: Record<string, Buffer> = {
  [PDF_MIME]:  Buffer.from([0x25, 0x50, 0x44, 0x46]),
  [DOCX_MIME]: DOCX_MAGIC,
  [XLSX_MIME]: XLSX_MAGIC,
};

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  const mimetype = overrides.mimetype ?? PDF_MIME;
  return {
    fieldname:    'file',
    originalname: 'test.pdf',
    encoding:     '7bit',
    mimetype,
    size:         1024,
    buffer:       MAGIC_BYTES[mimetype] ?? Buffer.alloc(4),
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
  const kafka  = { emit: jest.fn().mockResolvedValue(undefined), emitSafe: jest.fn() };
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

    it('throws BadRequestException with FILE_CONTENT_MISMATCH when buffer does not match declared MIME type', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      // PDF MIME declared but DOCX (PK ZIP) magic bytes supplied
      const spoofed = makeFile({ buffer: MAGIC_BYTES[DOCX_MIME] });

      await expect(service.upload('org-1', doc.id, spoofed)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'FILE_CONTENT_MISMATCH' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws BadRequestException with FILE_CONTENT_MISMATCH when DOCX bytes are submitted with XLSX MIME', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      // XLSX MIME declared but DOCX magic bytes supplied — cross-OOXML substitution
      const spoofed = makeFile({ mimetype: XLSX_MIME, buffer: DOCX_MAGIC });

      await expect(service.upload('org-1', doc.id, spoofed)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'FILE_CONTENT_MISMATCH' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
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

    it('emits audit log when actorId is provided', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await service.upload('org-1', doc.id, makeFile(), undefined, 'actor-user-1');

      expect(kafka.emitSafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ actorId: 'actor-user-1', action: 'TYPOLOGY_DOCUMENT_UPLOADED' }),
      );
    });

    it('throws InternalServerErrorException when Kafka emit fails and deletes the uploaded file', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      kafka.emit.mockRejectedValue(new Error('Kafka down'));
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(service.upload('org-1', doc.id, makeFile())).rejects.toThrow(InternalServerErrorException);
      expect(storage.delete).toHaveBeenCalled();
    });

    it('deletes orphaned upload and rethrows when DB save fails', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      (doc.save as jest.Mock).mockRejectedValueOnce(new Error('DB error'));
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(service.upload('org-1', doc.id, makeFile())).rejects.toThrow('DB error');
      expect(storage.delete).toHaveBeenCalled();
      expect(kafka.emit).not.toHaveBeenCalled();
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
      const kafka  = { emit: jest.fn().mockResolvedValue(undefined), emitSafe: jest.fn() };
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

    it('throws BadRequestException with FILE_CONTENT_MISMATCH when buffer does not match declared MIME type', async () => {
      const oldDoc = makeDoc();
      const FullModel: any = function () { return makeDoc(); };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });
      const storage = { upload: jest.fn(), delete: jest.fn() };
      const kafka   = { emit: jest.fn() };
      const logger  = { log: jest.fn() };
      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any);

      // PDF MIME declared but DOCX (PK ZIP) magic bytes supplied
      const spoofed = makeFile({ buffer: MAGIC_BYTES[DOCX_MIME] });
      await expect(
        service.createNewVersion('org-1', oldDoc.id, spoofed, {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'FILE_CONTENT_MISMATCH' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws BadRequestException with FILE_CONTENT_MISMATCH when DOCX bytes are submitted with XLSX MIME', async () => {
      const oldDoc = makeDoc();
      const FullModel: any = function () { return makeDoc(); };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });
      const storage = { upload: jest.fn(), delete: jest.fn() };
      const kafka   = { emit: jest.fn() };
      const logger  = { log: jest.fn() };
      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any);

      // XLSX MIME declared but DOCX magic bytes supplied — cross-OOXML substitution
      const spoofed = makeFile({ mimetype: XLSX_MIME, buffer: DOCX_MAGIC });
      await expect(
        service.createNewVersion('org-1', oldDoc.id, spoofed, {}),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'FILE_CONTENT_MISMATCH' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
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

  // ── retryExtraction() ────────────────────────────────────────────────────

  describe('retryExtraction()', () => {
    function makeFailedDoc(): TypologyDocument {
      return makeDoc({
        documento: {
          r2Key:             'org/org-1/typologies/file.pdf',
          originalName:      'file.pdf',
          mimeType:          PDF_MIME,
          uploadedAt:        new Date(),
          extractionStatus:  ExtractionStatus.FAILED,
        },
      });
    }

    it('sets PROCESSING, emits Kafka and returns success message', async () => {
      const doc = makeFailedDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      const result = await service.retryExtraction('org-1', doc.id);

      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.PROCESSING);
      expect(kafka.emit).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ orgId: 'org-1', typologyId: doc.id }),
      );
      expect(result).toEqual({ message: 'Extracción reencolada.', extractionStatus: ExtractionStatus.PROCESSING });
    });

    it('emits audit log when actorId is provided', async () => {
      const doc = makeFailedDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await service.retryExtraction('org-1', doc.id, undefined, 'actor-1');

      expect(kafka.emitSafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ actorId: 'actor-1', action: 'TYPOLOGY_EXTRACTION_RETRIED' }),
      );
    });

    it('restores FAILED status and throws InternalServerErrorException when Kafka fails', async () => {
      const doc = makeFailedDoc();
      const { model, storage, kafka, logger } = makeDeps(doc);
      kafka.emit.mockRejectedValue(new Error('Kafka down'));
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(InternalServerErrorException);
      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.FAILED);
    });

    it('throws BadRequestException for invalid typology ID', async () => {
      const { model, storage, kafka, logger } = makeDeps();
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(service.retryExtraction('org-1', 'not-an-id')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when typology does not exist', async () => {
      const { model, storage, kafka, logger } = makeDeps(null);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(service.retryExtraction('org-1', makeId())).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when no document has been uploaded', async () => {
      const doc = makeDoc(); // no r2Key
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when extraction status is not FAILED', async () => {
      const doc = makeDoc({
        documento: {
          r2Key:            'org/org-1/typologies/file.pdf',
          originalName:     'file.pdf',
          mimeType:         PDF_MIME,
          uploadedAt:       new Date(),
          extractionStatus: ExtractionStatus.PROCESSING,
        },
      });
      const { model, storage, kafka, logger } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any);

      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(BadRequestException);
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

import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
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

// Minimal 2-entry ZIP buffers for DOCX and XLSX. validateMagicBytes() requires a ZIP
// signature, a [Content_Types].xml entry (anywhere, not necessarily first), and a
// type-specific part — word/document.xml for DOCX, xl/workbook.xml for XLSX.
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
    deleteOne:      jest.fn().mockResolvedValue(undefined),
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
  const clamav = { scan: jest.fn().mockResolvedValue({ clean: true }) };
  return { model, storage, kafka, logger, clamav };
}

// ── DocumentUploadService ──────────────────────────────────────────────────

describe('DocumentUploadService', () => {

  // ── upload() ──────────────────────────────────────────────────────────────

  describe('upload()', () => {
    it('uploads a valid PDF and emits Kafka event', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

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
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

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
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await service.upload('org-1', doc.id, makeFile());

      expect(storage.delete).toHaveBeenCalledWith('org/org-1/typologies/old-file.pdf');
    });

    it('throws BadRequestException for unsupported MIME type', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(
        service.upload('org-1', doc.id, makeFile({ mimetype: 'image/jpeg' })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException with FILE_CONTENT_MISMATCH when buffer does not match declared MIME type', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      // PDF MIME declared but DOCX (PK ZIP) magic bytes supplied
      const spoofed = makeFile({ buffer: MAGIC_BYTES[DOCX_MIME] });

      await expect(service.upload('org-1', doc.id, spoofed)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'FILE_CONTENT_MISMATCH' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws BadRequestException with FILE_CONTENT_MISMATCH when DOCX bytes are submitted with XLSX MIME', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      // XLSX MIME declared but DOCX magic bytes supplied — cross-OOXML substitution
      const spoofed = makeFile({ mimetype: XLSX_MIME, buffer: DOCX_MAGIC });

      await expect(service.upload('org-1', doc.id, spoofed)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'FILE_CONTENT_MISMATCH' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when file exceeds 20 MB', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(
        service.upload('org-1', doc.id, makeFile({ size: 21 * 1024 * 1024 })),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for invalid typology ID', async () => {
      const { model, storage, kafka, logger, clamav } = makeDeps();
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(
        service.upload('org-1', 'not-an-id', makeFile()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when typology does not exist', async () => {
      const { model, storage, kafka, logger, clamav } = makeDeps(null);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(
        service.upload('org-1', makeId(), makeFile()),
      ).rejects.toThrow(NotFoundException);
    });

    it('accepts DOCX files', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(
        service.upload('org-1', doc.id, makeFile({ mimetype: DOCX_MIME, originalname: 'test.docx' })),
      ).resolves.not.toThrow();
    });

    it('emits audit log when actorId is provided', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await service.upload('org-1', doc.id, makeFile(), undefined, 'actor-user-1');

      expect(kafka.emitSafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ actorId: 'actor-user-1', action: 'TYPOLOGY_DOCUMENT_UPLOADED' }),
      );
    });

    // A rejected producer.send() doesn't prove Kafka never got the message —
    // the ack round-trip can fail after a successful write. So this must NOT
    // roll back the upload (that would risk deleting/reverting data an
    // already-delivered event still references) — it only marks extraction
    // FAILED and leaves recovery to the existing retryExtraction() flow.
    it('keeps the uploaded document (does not roll back) and marks extraction FAILED when the Kafka emit fails', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      kafka.emit.mockRejectedValue(new Error('Kafka down'));
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      const result = await service.upload('org-1', doc.id, makeFile());

      expect(result.extractionStatus).toBe(ExtractionStatus.FAILED);
      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.FAILED);
      expect(doc.documento.r2Key).not.toBeNull(); // new file kept, not reverted
      expect(storage.delete).not.toHaveBeenCalled(); // no previous file, and the new one is kept
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('delivery is unconfirmed'),
        expect.any(String), // err.stack
        'DocumentUploadService',
      );
    });

    // Regression: the compensating save() that persists extractionStatus =
    // FAILED used to swallow its own failure silently (`.catch(() => {})`).
    // If it fails, the DB is left stuck at PROCESSING — the response must
    // not claim FAILED in that case (a status that never made it to the
    // DB), since retryExtraction() only accepts a retry when the persisted
    // status is already FAILED; claiming FAILED here would mislead the
    // caller into believing a retry is possible when it isn't yet.
    it('does not claim FAILED when the compensating save itself fails — reports the truly persisted PROCESSING status instead, and logs loudly', async () => {
      const doc = makeDoc();
      (doc.save as jest.Mock)
        .mockResolvedValueOnce(undefined) // Step 2's normal persist (leaves PROCESSING durably in the DB)
        .mockRejectedValueOnce(new Error('DB down')); // the compensating save in the catch block
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      kafka.emit.mockRejectedValue(new Error('Kafka down'));
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      const result = await service.upload('org-1', doc.id, makeFile());

      expect(result.extractionStatus).toBe(ExtractionStatus.PROCESSING);
      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.PROCESSING);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to persist extractionStatus=FAILED for typology ${doc.id}`),
        expect.any(String),
        'DocumentUploadService',
      );
    });

    it('still deletes the previous file after a Kafka failure — the new document is already canonical either way', async () => {
      const doc = makeDoc({
        documento: { r2Key: 'org/org-1/typologies/old-file.pdf', extractionStatus: ExtractionStatus.COMPLETED, originalName: 'old.pdf', mimeType: PDF_MIME, uploadedAt: new Date() },
      });
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      kafka.emit.mockRejectedValue(new Error('Kafka down'));
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await service.upload('org-1', doc.id, makeFile());

      expect(storage.delete).toHaveBeenCalledWith('org/org-1/typologies/old-file.pdf');
    });

    it('deletes orphaned upload and rethrows when DB save fails', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      (doc.save as jest.Mock).mockRejectedValueOnce(new Error('DB error'));
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.upload('org-1', doc.id, makeFile())).rejects.toThrow('DB error');
      expect(storage.delete).toHaveBeenCalled();
      expect(kafka.emit).not.toHaveBeenCalled();
    });

    it('bloquea la carga cuando ClamAV reporta malware', async () => {
      const doc = makeDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      clamav.scan.mockResolvedValueOnce({ clean: false, threat: 'Eicar-Test-Signature' });
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.upload('org-1', doc.id, makeFile())).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'MALWARE_DETECTED' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
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
      const clamav = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      await service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' });

      expect(oldDoc.typologyStatus).toBe(TypologyStatus.ARCHIVED);
      expect(oldDoc.save).toHaveBeenCalled();
      expect(storage.upload).toHaveBeenCalled();
      expect(kafka.emit).toHaveBeenCalled();
    });

    it('trims nombre/version from raw multipart fields before persisting the new version', async () => {
      const oldDoc = makeDoc({
        datosDeclarados: { nombre: 'Policy', codigo: 'POL-001', version: '01', fuente: DataSource.MANUAL },
      });
      const newDoc = makeDoc({ id: makeId() });

      let capturedArgs: any;
      const FullModel: any = function (args: any) {
        capturedArgs = args;
        return newDoc;
      };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
      const kafka   = { emit: jest.fn().mockResolvedValue(undefined), emitSafe: jest.fn() };
      const logger  = { log: jest.fn(), warn: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      await service.createNewVersion('org-1', oldDoc.id, makeFile(), {
        nombre: '  New Name  ',
        version: '  02  ',
      });

      expect(capturedArgs.datosDeclarados.nombre).toBe('New Name');
      expect(capturedArgs.datosDeclarados.version).toBe('02');
    });

    it('throws BadRequestException for version that is not exactly one increment', async () => {
      const oldDoc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'C', version: '01', fuente: DataSource.MANUAL } });
      const FullModel: any = function () { return makeDoc(); };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn(), delete: jest.fn() };
      const kafka   = { emit: jest.fn() };
      const logger  = { log: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
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
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
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
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };
      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);

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
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };
      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);

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
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      await expect(
        service.createNewVersion('org-1', makeId(), makeFile(), {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('bloquea createNewVersion cuando ClamAV reporta malware', async () => {
      const oldDoc = makeDoc();
      const FullModel: any = function () { return makeDoc(); };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });
      const storage = { upload: jest.fn(), delete: jest.fn() };
      const kafka   = { emit: jest.fn() };
      const logger  = { log: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };
      clamav.scan.mockResolvedValueOnce({ clean: false, threat: 'Eicar-Test-Signature' });

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      await expect(
        service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'MALWARE_DETECTED' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
      expect(kafka.emit).not.toHaveBeenCalled();
    });

    // Regression: old used to stay ACTIVE until every step succeeded, with
    // newDoc created ACTIVE (same codigo) as the very first step — meaning
    // old and newDoc were briefly BOTH ACTIVE with the same codigo, which
    // the unique-active-codigo index (typology.schema.ts) forbids. That made
    // every version bump of an already-complete typology an unconditional
    // failure, not just a rare race. old must now be archived first.
    it('archives old BEFORE saving newDoc as ACTIVE, so they never collide on the unique-active-codigo index', async () => {
      const callOrder: string[] = [];
      const oldDoc = makeDoc();
      (oldDoc.save as jest.Mock).mockImplementation(async () => { callOrder.push('old.save'); });
      const newDoc = makeDoc({ id: makeId() });
      (newDoc.save as jest.Mock).mockImplementation(async () => { callOrder.push('newDoc.save'); });

      const FullModel: any = function () { return newDoc; };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
      const kafka   = { emit: jest.fn().mockResolvedValue(undefined), emitSafe: jest.fn() };
      const logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      await service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' });

      expect(callOrder[0]).toBe('old.save');
      expect(oldDoc.typologyStatus).toBe(TypologyStatus.ARCHIVED);
    });

    it('throws ConflictException and restores old to ACTIVE when newDoc.save() collides (11000), without ever uploading the file', async () => {
      const oldDoc = makeDoc();
      const newDoc = makeDoc({ id: makeId() });
      const dupErr: any = new Error('dup key');
      dupErr.code = 11000;
      (newDoc.save as jest.Mock).mockRejectedValue(dupErr);

      const FullModel: any = function () { return newDoc; };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn(), delete: jest.fn() };
      const kafka   = { emit: jest.fn() };
      const logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      await expect(
        service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' }),
      ).rejects.toThrow(ConflictException);

      expect(oldDoc.typologyStatus).toBe(TypologyStatus.ACTIVE); // restored
      expect(oldDoc.save).toHaveBeenCalledTimes(2); // archive, then restore
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('deletes newDoc and restores old to ACTIVE when the file upload fails', async () => {
      const oldDoc = makeDoc();
      const newDoc = makeDoc({ id: makeId() });

      const FullModel: any = function () { return newDoc; };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn().mockRejectedValue(new Error('storage down')), delete: jest.fn().mockResolvedValue(undefined) };
      const kafka   = { emit: jest.fn() };
      const logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      await expect(
        service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' }),
      ).rejects.toThrow('storage down');

      expect(newDoc.deleteOne).toHaveBeenCalled();
      expect(oldDoc.typologyStatus).toBe(TypologyStatus.ACTIVE);
    });

    // A rejected producer.send() doesn't prove Kafka never got the message —
    // the ack round-trip can fail after a successful write. So this must NOT
    // roll back the version bump (that would risk deleting data a delivered
    // event still references) — it only marks extraction FAILED and leaves
    // recovery to the existing retryExtraction() flow.
    it('keeps the new version (does not roll back) and marks extraction FAILED when the Kafka emit fails, instead of deleting data an already-delivered event might reference', async () => {
      const oldDoc = makeDoc();
      const newDoc = makeDoc({ id: makeId() });

      const FullModel: any = function () { return newDoc; };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
      const kafka   = { emit: jest.fn().mockRejectedValue(new Error('Kafka down')) };
      const logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      const result = await service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' });

      expect(result.documento.extractionStatus).toBe(ExtractionStatus.FAILED);
      expect(newDoc.deleteOne).not.toHaveBeenCalled();
      expect(storage.delete).not.toHaveBeenCalled();
      expect(oldDoc.typologyStatus).toBe(TypologyStatus.ARCHIVED); // not restored — newDoc is the real active one now
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('delivery is unconfirmed'),
        expect.any(String), // err.stack
        'DocumentUploadService',
      );
    });

    // Regression: same root cause as the equivalent upload() test above —
    // the compensating save() that persists extractionStatus = FAILED used
    // to swallow its own failure silently. The returned DTO must not claim
    // FAILED when that never made it to the DB.
    it('does not claim FAILED when the compensating save itself fails — reports the truly persisted PROCESSING status instead, and logs loudly', async () => {
      const oldDoc = makeDoc();
      const newDoc = makeDoc({ id: makeId() });
      (newDoc.save as jest.Mock)
        .mockResolvedValueOnce(undefined) // Step 2: create as ACTIVE
        .mockResolvedValueOnce(undefined) // Step 4: persist documento (leaves PROCESSING durably in the DB)
        .mockRejectedValueOnce(new Error('DB down')); // the compensating save in Step 5's catch block

      const FullModel: any = function () { return newDoc; };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
      const kafka   = { emit: jest.fn().mockRejectedValue(new Error('Kafka down')) };
      const logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      const result = await service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' });

      expect(result.documento.extractionStatus).toBe(ExtractionStatus.PROCESSING);
      expect(newDoc.documento.extractionStatus).toBe(ExtractionStatus.PROCESSING);

      const newTypologyId = (newDoc._id as { toString(): string }).toString();
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to persist extractionStatus=FAILED for new typology version ${newTypologyId}`),
        expect.any(String),
        'DocumentUploadService',
      );
    });

    it('logs loudly instead of silently swallowing when restoring old to ACTIVE itself fails', async () => {
      const oldDoc = makeDoc();
      const newDoc = makeDoc({ id: makeId() });
      const dupErr: any = new Error('dup key');
      dupErr.code = 11000;
      (newDoc.save as jest.Mock).mockRejectedValue(dupErr);
      // Second call to old.save() is the restore attempt (first archives it) — that one fails.
      (oldDoc.save as jest.Mock)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('DB down'));

      const FullModel: any = function () { return newDoc; };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn(), delete: jest.fn() };
      const kafka   = { emit: jest.fn() };
      const logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      await expect(
        service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' }),
      ).rejects.toThrow(ConflictException);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('stuck ARCHIVED with no active replacement'),
        undefined,
        'DocumentUploadService',
      );
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
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

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
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await service.retryExtraction('org-1', doc.id, undefined, 'actor-1');

      expect(kafka.emitSafe).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ actorId: 'actor-1', action: 'TYPOLOGY_EXTRACTION_RETRIED' }),
      );
    });

    it('restores FAILED status and throws InternalServerErrorException when Kafka fails', async () => {
      const doc = makeFailedDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      kafka.emit.mockRejectedValue(new Error('Kafka down'));
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(InternalServerErrorException);
      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.FAILED);
    });

    // Regression: same root cause as the equivalent upload()/createNewVersion()
    // tests — the compensating save() that reverts extractionStatus back to
    // FAILED used to swallow its own failure silently, leaving the typology
    // stuck at PROCESSING with nothing in the logs to explain why a future
    // retryExtraction() call also gets rejected.
    it('logs loudly when the compensating save (extractionStatus = FAILED) itself fails after a Kafka failure', async () => {
      const doc = makeFailedDoc();
      (doc.save as jest.Mock)
        .mockResolvedValueOnce(undefined) // sets PROCESSING before emitting
        .mockRejectedValueOnce(new Error('DB down')); // the compensating save in the catch block
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      kafka.emit.mockRejectedValue(new Error('Kafka down'));
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(InternalServerErrorException);

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to revert extractionStatus back to FAILED for typology ${doc.id}`),
        expect.any(String),
        'DocumentUploadService',
      );
    });

    it('throws BadRequestException for invalid typology ID', async () => {
      const { model, storage, kafka, logger, clamav } = makeDeps();
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.retryExtraction('org-1', 'not-an-id')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when typology does not exist', async () => {
      const { model, storage, kafka, logger, clamav } = makeDeps(null);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.retryExtraction('org-1', makeId())).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when no document has been uploaded', async () => {
      const doc = makeDoc(); // no r2Key
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

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
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(BadRequestException);
    });

    // ── Recovery path for a typology stuck in PROCESSING (STUCK_EXTRACTION_THRESHOLD_MS) ──
    // Without this, a typology whose compensating write (see upload()/
    // createNewVersion()) failed to persist FAILED after a Kafka emit
    // failure was left permanently stuck: retryExtraction() only ever
    // accepted FAILED, so nothing could unblock it via the API.

    it('allows a retry when PROCESSING has been stuck longer than the threshold', async () => {
      const doc = makeDoc({
        documento: {
          r2Key:            'org/org-1/typologies/file.pdf',
          originalName:     'file.pdf',
          mimeType:         PDF_MIME,
          uploadedAt:       new Date(Date.now() - 20 * 60 * 1000), // 20 min ago > 15 min threshold
          extractionStatus: ExtractionStatus.PROCESSING,
        },
      });
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      const result = await service.retryExtraction('org-1', doc.id);

      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.PROCESSING);
      expect(kafka.emit).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Extracción reencolada.', extractionStatus: ExtractionStatus.PROCESSING });
    });

    it('still rejects PROCESSING that has not yet crossed the stuck threshold', async () => {
      const doc = makeDoc({
        documento: {
          r2Key:            'org/org-1/typologies/file.pdf',
          originalName:     'file.pdf',
          mimeType:         PDF_MIME,
          uploadedAt:       new Date(Date.now() - 5 * 60 * 1000), // 5 min ago < 15 min threshold
          extractionStatus: ExtractionStatus.PROCESSING,
        },
      });
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(BadRequestException);
      expect(kafka.emit).not.toHaveBeenCalled();
    });

    it('rejects PROCESSING with no uploadedAt to measure staleness against, rather than assuming it is stuck', async () => {
      const doc = makeDoc({
        documento: {
          r2Key:            'org/org-1/typologies/file.pdf',
          originalName:     'file.pdf',
          mimeType:         PDF_MIME,
          uploadedAt:       null,
          extractionStatus: ExtractionStatus.PROCESSING,
        },
      });
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(BadRequestException);
      expect(kafka.emit).not.toHaveBeenCalled();
    });
  });

  // ── getSignedUrl() ────────────────────────────────────────────────────────

  describe('getSignedUrl()', () => {
    it('returns signed URL for typology with uploaded document', async () => {
      const doc = makeDoc({
        documento: { r2Key: 'org/org-1/typologies/file.pdf', extractionStatus: ExtractionStatus.COMPLETED, originalName: 'file.pdf', mimeType: PDF_MIME, uploadedAt: new Date() },
      });
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      const result = await service.getSignedUrl('org-1', doc.id);

      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith('org/org-1/typologies/file.pdf', 'file.pdf', 'application/pdf');
      expect(result.signedUrl).toBe('https://signed.url');
    });

    it('throws NotFoundException when typology has no document', async () => {
      const doc = makeDoc(); // no r2Key
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.getSignedUrl('org-1', doc.id)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException for invalid ID', async () => {
      const { model, storage, kafka, logger, clamav } = makeDeps();
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.getSignedUrl('org-1', 'bad')).rejects.toThrow(BadRequestException);
    });
  });
});

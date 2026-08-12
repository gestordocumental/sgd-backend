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

// Mirrors DocumentUploadService's own STUCK_EXTRACTION_THRESHOLD_MS (not
// exported — this is the retry-eligibility window, not a magic number).
const STUCK_EXTRACTION_THRESHOLD_MS = 15 * 60 * 1000;

function makeDeps(doc: TypologyDocument | null = null) {
  const model: any = {
    findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) }),
    // Simulates retryExtraction()'s atomic conditional claim: matches (and
    // mutates, like a real findOneAndUpdate(..., { new: true })) only when
    // `doc` is currently retriable (FAILED, or PROCESSING stuck past the
    // threshold) — otherwise resolves null, same as a real update matching
    // zero documents. Mutating the same shared `doc` reference is what
    // makes the "reject an immediate second retry" regression test work:
    // the second call re-evaluates the first call's own mutation.
    findOneAndUpdate: jest.fn().mockReturnValue({
      exec: jest.fn().mockImplementation(async () => {
        if (!doc) return null;
        const { extractionStatus, extractionStartedAt } = doc.documento;
        const stuck =
          extractionStatus === ExtractionStatus.PROCESSING &&
          !!extractionStartedAt &&
          Date.now() - extractionStartedAt.getTime() > STUCK_EXTRACTION_THRESHOLD_MS;
        if (extractionStatus !== ExtractionStatus.FAILED && !stuck) return null;
        doc.documento.extractionStatus = ExtractionStatus.PROCESSING;
        doc.documento.extractionStartedAt = new Date();
        return doc;
      }),
    }),
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

    // ── Pending-transition marker (crash recovery — see PendingVersionTransition
    // in typology.schema.ts and TypologiesService.reconcilePendingVersionTransitions()) ──
    // archive-old/create-new are two separate MongoDB writes (this deployment's
    // Mongo runs standalone, not a replica set, so no multi-document
    // transaction is available) — the marker is what makes a process crash
    // between them recoverable at the next service startup.

    it('sets the pending-transition marker on old in the same write that archives it, naming newDoc\'s pre-generated _id', async () => {
      const oldDoc = makeDoc();
      const newDoc = makeDoc({ id: makeId() });
      const saveSnapshots: Array<{ typologyStatus: TypologyStatus; pendingVersionTransition: { newTypologyId: string } | null }> = [];
      (oldDoc.save as jest.Mock).mockImplementation(async () => {
        saveSnapshots.push({
          typologyStatus: oldDoc.typologyStatus,
          pendingVersionTransition: oldDoc.pendingVersionTransition
            ? { ...(oldDoc.pendingVersionTransition as { newTypologyId: string }) }
            : null,
        });
      });

      let capturedArgs: any;
      const FullModel: any = function (args: any) {
        capturedArgs = args;
        return newDoc;
      };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
      const kafka   = { emit: jest.fn().mockResolvedValue(undefined), emitSafe: jest.fn() };
      const logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      await service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' });

      // First old.save() call = Step 1 — archive + marker, atomically together.
      expect(saveSnapshots[0].typologyStatus).toBe(TypologyStatus.ARCHIVED);
      expect(saveSnapshots[0].pendingVersionTransition?.newTypologyId).toBe(
        (capturedArgs._id as { toString(): string }).toString(),
      );
      // newDoc itself was constructed with that same pre-generated _id.
      expect(capturedArgs._id).toBeDefined();
    });

    it('clears the pending-transition marker on old once newDoc is fully written (before the Kafka emit)', async () => {
      const oldDoc = makeDoc();
      const newDoc = makeDoc({ id: makeId() });

      const FullModel: any = function () { return newDoc; };
      FullModel.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(oldDoc) });

      const storage = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn().mockResolvedValue(undefined) };
      const kafka   = { emit: jest.fn().mockResolvedValue(undefined), emitSafe: jest.fn() };
      const logger  = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
      const clamav  = { scan: jest.fn().mockResolvedValue({ clean: true }) };

      const service = new DocumentUploadService(FullModel, storage as any, kafka as any, logger as any, clamav as any);
      await service.createNewVersion('org-1', oldDoc.id, makeFile(), { version: '02' });

      expect(oldDoc.pendingVersionTransition).toBeNull();
      // archive (marker set) + clear-marker = 2 calls minimum on old.save().
      expect((oldDoc.save as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
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
      // restoreOldActive() must also clear the pending-transition marker set
      // in Step 1 — otherwise a later startup reconciliation sweep would
      // find this already-healthy typology and wrongly try to "fix" it again.
      expect(oldDoc.pendingVersionTransition).toBeNull();
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

      // Not asserting the exact id here — createNewVersion() now pre-generates
      // newDoc's _id itself (see the dedicated "threads the pre-generated _id"
      // test below), and this fake FullModel constructor doesn't echo
      // constructor args back onto newDoc, so newDoc._id in this test double
      // is unrelated to what production code actually passed in.
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to persist extractionStatus=FAILED for new typology version'),
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
      // The claim to PROCESSING is now the atomic findOneAndUpdate() (mocked
      // above, doesn't call doc.save()) — the only remaining doc.save() call
      // in this flow is the compensating revert-to-FAILED one below.
      (doc.save as jest.Mock).mockRejectedValueOnce(new Error('DB down'));
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
          r2Key:               'org/org-1/typologies/file.pdf',
          originalName:        'file.pdf',
          mimeType:            PDF_MIME,
          uploadedAt:          new Date(Date.now() - 20 * 60 * 1000),
          extractionStartedAt: new Date(Date.now() - 20 * 60 * 1000), // 20 min ago > 15 min threshold
          extractionStatus:    ExtractionStatus.PROCESSING,
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
          r2Key:               'org/org-1/typologies/file.pdf',
          originalName:        'file.pdf',
          mimeType:            PDF_MIME,
          uploadedAt:          new Date(Date.now() - 5 * 60 * 1000),
          extractionStartedAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago < 15 min threshold
          extractionStatus:    ExtractionStatus.PROCESSING,
        },
      });
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(BadRequestException);
      expect(kafka.emit).not.toHaveBeenCalled();
    });

    it('rejects PROCESSING with no extractionStartedAt to measure staleness against, rather than assuming it is stuck', async () => {
      const doc = makeDoc({
        documento: {
          r2Key:               'org/org-1/typologies/file.pdf',
          originalName:        'file.pdf',
          mimeType:            PDF_MIME,
          uploadedAt:          new Date(Date.now() - 20 * 60 * 1000), // old upload — must not be used as the signal
          extractionStartedAt: null,
          extractionStatus:    ExtractionStatus.PROCESSING,
        },
      });
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(BadRequestException);
      expect(kafka.emit).not.toHaveBeenCalled();
    });

    // Regression: uploadedAt never changes across retries, so a threshold
    // check anchored to it would never reset — once a file is older than
    // STUCK_EXTRACTION_THRESHOLD_MS, every subsequent PROCESSING state,
    // including one from a retry that started moments ago, would always
    // look "stuck" and be re-interruptible. extractionStartedAt is
    // re-claimed on every successful retry specifically to prevent this.
    it('rejects an immediate second retry right after a successful re-emission, even though the file itself is old', async () => {
      const doc = makeDoc({
        documento: {
          r2Key:               'org/org-1/typologies/file.pdf',
          originalName:        'file.pdf',
          mimeType:            PDF_MIME,
          uploadedAt:          new Date(Date.now() - 20 * 60 * 1000), // file is old — was already past the threshold once
          extractionStartedAt: new Date(Date.now() - 20 * 60 * 1000),
          extractionStatus:    ExtractionStatus.PROCESSING,
        },
      });
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      const first = await service.retryExtraction('org-1', doc.id);
      expect(first.extractionStatus).toBe(ExtractionStatus.PROCESSING);
      expect(kafka.emit).toHaveBeenCalledTimes(1);

      // extractionStartedAt was just re-claimed to "now" by the call above —
      // an immediate second call must NOT see it as stuck anymore.
      await expect(service.retryExtraction('org-1', doc.id)).rejects.toThrow(BadRequestException);
      expect(kafka.emit).toHaveBeenCalledTimes(1); // no second emit
    });

    // Regression: the precondition check and the claim used to be a plain
    // read-then-save, not atomic — two concurrent retryExtraction() calls
    // could both load the same FAILED state, both pass the in-memory check,
    // and both save()+emit (a genuine double-fire, distinct from the
    // sequential-retry case above). The atomic findOneAndUpdate() filter is
    // what actually closes this: only one of two racing calls can
    // match-and-claim in the same operation.
    it('when two retryExtraction() calls race on the same typology, only one succeeds and exactly one Kafka event is emitted', async () => {
      const doc = makeFailedDoc();
      const { model, storage, kafka, logger, clamav } = makeDeps(doc);
      const service = new DocumentUploadService(model, storage as any, kafka as any, logger as any, clamav as any);

      const [first, second] = await Promise.allSettled([
        service.retryExtraction('org-1', doc.id),
        service.retryExtraction('org-1', doc.id),
      ]);

      const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
      const rejected  = [first, second].filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
      expect(kafka.emit).toHaveBeenCalledTimes(1);
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

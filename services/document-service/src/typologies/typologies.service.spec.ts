import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
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
  const id = makeId();
  return {
    id,
    _id:            new Types.ObjectId(id),
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
  // Distinguishes the two shapes of findOne() call this service makes:
  // the id-based lookup (findOne/update/resolveDiscrepancy's initial fetch,
  // by _id) resolves to docOrNull as before; the duplicate-active-codigo
  // pre-check (assertNoActiveDuplicateCodigo, filtered by
  // 'datosDeclarados.codigo' + typologyStatus, no _id) defaults to "no
  // collision" (null) — tests that need to simulate one override with
  // mockReturnValueOnce before calling the service method under test.
  Model.findOne = jest.fn().mockImplementation((filter: any = {}) => {
    // assertNoActiveDuplicateCodigo's filter always includes typologyStatus:
    // ACTIVE; the id-based lookups (findOne/update/resolveDiscrepancy's
    // initial fetch) never do — that's what tells the two apart here.
    if ('typologyStatus' in filter) {
      return { exec: jest.fn().mockResolvedValue(null) };
    }
    return { exec: jest.fn().mockResolvedValue(docOrNull) };
  });
  Model.find     = jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([]) });
  Model.updateOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) });
  Model.deleteOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }) });
  Model.countDocuments = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
  Model.syncIndexes = jest.fn().mockResolvedValue([]);
  return { Model, instance };
}

let mockKafkaProducer: { emitSafe: jest.Mock };
let mockLogger: { log: jest.Mock; error: jest.Mock; warn: jest.Mock; debug: jest.Mock };

// ── TypologiesService ──────────────────────────────────────────────────────

describe('TypologiesService', () => {
  beforeEach(() => {
    mockKafkaProducer = { emitSafe: jest.fn() };
    mockLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  });

  const makeService = (Model: any): TypologiesService =>
    new TypologiesService(Model, mockKafkaProducer as any, mockLogger as any);

  // ── onModuleInit ─────────────────────────────────────────────────────────

  describe('onModuleInit()', () => {
    it('syncs indexes silently on success', async () => {
      const { Model } = makeModel();
      const service = makeService(Model);

      await service.onModuleInit();

      expect(Model.syncIndexes).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('logs an error instead of throwing when index sync fails (e.g. pre-existing duplicate ACTIVE codigos)', async () => {
      const { Model } = makeModel();
      const syncError = new Error('E11000 duplicate key error');
      Model.syncIndexes = jest.fn().mockRejectedValue(syncError);
      const service = makeService(Model);

      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('unique-active-codigo constraint'),
        expect.any(String),
        'TypologiesService',
      );
    });

    // Regression: a pre-check read-then-write can't guarantee uniqueness on
    // its own under concurrent requests — the real guarantee is the Mongo
    // unique index. If syncIndexes() can't confirm that index is built,
    // every write path that would otherwise rely on the pre-check must
    // fail closed instead of silently accepting an unbounded race window
    // (two concurrent requests both reading "no duplicate" and both saving).
    it('blocks create()/update()/resolveDiscrepancy() with ServiceUnavailableException after a failed index sync, without ever touching the DB', async () => {
      const { Model, instance } = makeModel(makeDoc({
        documento: { extractionStatus: ExtractionStatus.DISCREPANCY, r2Key: null, originalName: null, mimeType: null, uploadedAt: null },
        metadataExtraida: { nombre: 'Policy', codigo: 'POL-002', version: '01', extractedAt: new Date(), discrepancias: [] },
      }));
      Model.syncIndexes = jest.fn().mockRejectedValue(new Error('E11000 duplicate key error'));
      const service = makeService(Model);
      await service.onModuleInit();
      mockLogger.error.mockClear();

      await expect(
        service.create('org-1', { departamentoId: 'dept-1', codigo: 'POL-001' }, STRUCTURE_NAMES),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(instance.save).not.toHaveBeenCalled();

      await expect(
        service.update('org-1', instance.id, { codigo: 'POL-003' }),
      ).rejects.toThrow(ServiceUnavailableException);

      await expect(
        service.resolveDiscrepancy('org-1', instance.id, { action: ResolveAction.ADOPT_EXTRACTED }),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(instance.save).not.toHaveBeenCalled();
    });
  });

  // ── reconcilePendingVersionTransitions (private, called from onModuleInit) ──
  // Repairs DocumentUploadService.createNewVersion()'s archive-old/create-new
  // sequence when a process crash left a typology ARCHIVED with a pending
  // marker and no confirmed ACTIVE replacement — see PendingVersionTransition
  // in typology.schema.ts.

  describe('reconcilePendingVersionTransitions() (via onModuleInit)', () => {
    it('does nothing when no typology has a pending version transition', async () => {
      const { Model } = makeModel(); // default find() → []
      const service = makeService(Model);

      await service.onModuleInit();

      expect(Model.find).toHaveBeenCalledWith({ pendingVersionTransition: { $ne: null } });
    });

    it('clears the marker without touching typologyStatus when the new version was already fully written', async () => {
      const stuckDoc = makeDoc({
        typologyStatus: TypologyStatus.ARCHIVED,
        pendingVersionTransition: { newTypologyId: 'new-1', startedAt: new Date() },
      });
      const Model: any = jest.fn();
      Model.syncIndexes = jest.fn().mockResolvedValue([]);
      Model.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([stuckDoc]) });
      // "fully written" — findOne() with documento.r2Key: { $ne: null } finds it.
      Model.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(makeDoc({ id: 'new-1' })) });
      Model.deleteOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ deletedCount: 0 }) });

      const service = makeService(Model);
      await service.onModuleInit();

      expect(Model.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: 'new-1', 'documento.r2Key': { $ne: null } }),
      );
      expect(stuckDoc.pendingVersionTransition).toBeNull();
      expect(stuckDoc.typologyStatus).toBe(TypologyStatus.ARCHIVED); // untouched — the new version really is the active one
      expect(stuckDoc.save).toHaveBeenCalled();
      expect(Model.deleteOne).not.toHaveBeenCalled();
    });

    it('restores old to ACTIVE and discards the partial new version when it was never fully written', async () => {
      const stuckDoc = makeDoc({
        typologyStatus: TypologyStatus.ARCHIVED,
        pendingVersionTransition: { newTypologyId: 'new-1', startedAt: new Date() },
      });
      const Model: any = jest.fn();
      Model.syncIndexes = jest.fn().mockResolvedValue([]);
      Model.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([stuckDoc]) });
      Model.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }); // never fully written
      Model.deleteOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }) });

      const service = makeService(Model);
      await service.onModuleInit();

      expect(stuckDoc.typologyStatus).toBe(TypologyStatus.ACTIVE);
      expect(stuckDoc.pendingVersionTransition).toBeNull();
      expect(stuckDoc.save).toHaveBeenCalled();
      expect(Model.deleteOne).toHaveBeenCalledWith({ _id: 'new-1', orgId: stuckDoc.orgId, deletedAt: null });
    });

    // Regression: the cleanup deleteOne() used to have no deletedAt filter,
    // so it would HARD-delete newTypologyId unconditionally. The
    // "never fully written" branch is reached any time newDocFullyWritten's
    // own query (which does filter deletedAt: null) finds nothing — including
    // when newDoc was actually fully written (has documento.r2Key) but has
    // since been legitimately soft-deleted by a user. Without the same
    // deletedAt: null filter here, that real historical record — which
    // findHistory() is supposed to still be able to show — would be
    // permanently destroyed instead of just left alone.
    it('does not hard-delete newDoc if it was already legitimately soft-deleted — deletedCount: 0 still restores old normally', async () => {
      const stuckDoc = makeDoc({
        typologyStatus: TypologyStatus.ARCHIVED,
        pendingVersionTransition: { newTypologyId: 'new-1', startedAt: new Date() },
      });
      const Model: any = jest.fn();
      Model.syncIndexes = jest.fn().mockResolvedValue([]);
      Model.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([stuckDoc]) });
      // newDocFullyWritten's own deletedAt: null filter excludes it, even
      // though it was in fact fully written before being soft-deleted.
      Model.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      // deleteOne, now scoped to deletedAt: null, matches nothing — the doc
      // is already soft-deleted, not hard-deleted.
      Model.deleteOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 0 }) });

      const service = makeService(Model);
      await service.onModuleInit();

      expect(Model.deleteOne).toHaveBeenCalledWith({ _id: 'new-1', orgId: stuckDoc.orgId, deletedAt: null });
      expect(stuckDoc.typologyStatus).toBe(TypologyStatus.ACTIVE);
      expect(stuckDoc.pendingVersionTransition).toBeNull();
      expect(stuckDoc.save).toHaveBeenCalled();
    });

    // Regression: deleteOne() resolving is not the same as the delete being
    // confirmed — an unacknowledged write (acknowledged: false) resolves
    // without throwing, so a plain "did it resolve" check would treat it as
    // success and restore old anyway, doomed to collide with newDoc still
    // sitting ACTIVE (or, here, incomplete but not yet cleaned up) on the
    // same codigo. deletedCount alone isn't the right signal either —
    // deletedCount === 0 alongside acknowledged: true just means newDoc was
    // already gone, which is fine.
    it('does not restore old or clear the marker when deleting the partial newDoc resolves but is unacknowledged', async () => {
      const stuckDoc = makeDoc({
        typologyStatus: TypologyStatus.ARCHIVED,
        pendingVersionTransition: { newTypologyId: 'new-1', startedAt: new Date() },
      });
      const Model: any = jest.fn();
      Model.syncIndexes = jest.fn().mockResolvedValue([]);
      Model.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([stuckDoc]) });
      Model.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }); // never fully written
      Model.deleteOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: false, deletedCount: 0 }) });

      const service = makeService(Model);
      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(Model.deleteOne).toHaveBeenCalledWith({ _id: 'new-1', orgId: stuckDoc.orgId, deletedAt: null });
      expect(stuckDoc.save).not.toHaveBeenCalled();
      expect(stuckDoc.typologyStatus).toBe(TypologyStatus.ARCHIVED);
      expect(stuckDoc.pendingVersionTransition).not.toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reconcile pending version transition'),
        expect.any(String),
        'TypologiesService',
      );
    });

    // Regression: deleting the partial newDoc used to be best-effort
    // (.catch(() => {})) AFTER old was already restored and its marker
    // cleared — a transient delete failure left newDoc orphaned forever,
    // since nothing sweeps for it once the marker is gone. Deleting first
    // means a failure here must leave old untouched (still ARCHIVED, marker
    // still set) so the NEXT startup's sweep finds this doc again and retries.
    it('does not restore old or clear the marker when deleting the partial newDoc fails — leaves it for the next startup to retry', async () => {
      const stuckDoc = makeDoc({
        typologyStatus: TypologyStatus.ARCHIVED,
        pendingVersionTransition: { newTypologyId: 'new-1', startedAt: new Date() },
      });
      const Model: any = jest.fn();
      Model.syncIndexes = jest.fn().mockResolvedValue([]);
      Model.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([stuckDoc]) });
      Model.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }); // never fully written
      Model.deleteOne = jest.fn().mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error('Mongo down')) });

      const service = makeService(Model);
      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(Model.deleteOne).toHaveBeenCalledWith({ _id: 'new-1', orgId: stuckDoc.orgId, deletedAt: null });
      expect(stuckDoc.save).not.toHaveBeenCalled();
      expect(stuckDoc.typologyStatus).toBe(TypologyStatus.ARCHIVED);
      expect(stuckDoc.pendingVersionTransition).not.toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reconcile pending version transition'),
        expect.any(String),
        'TypologiesService',
      );
    });

    it('logs and reports to Sentry instead of throwing when reconciling one typology fails, without blocking startup', async () => {
      const stuckDoc = makeDoc({
        typologyStatus: TypologyStatus.ARCHIVED,
        pendingVersionTransition: { newTypologyId: 'new-1', startedAt: new Date() },
      });
      (stuckDoc.save as jest.Mock).mockRejectedValue(new Error('DB down'));
      const Model: any = jest.fn();
      Model.syncIndexes = jest.fn().mockResolvedValue([]);
      Model.find = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([stuckDoc]) });
      Model.findOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
      Model.deleteOne = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 0 }) });

      const service = makeService(Model);
      await expect(service.onModuleInit()).resolves.toBeUndefined();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to reconcile pending version transition'),
        expect.any(String),
        'TypologiesService',
      );
    });
  });

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
    it('queries typologies of all statuses with correct pagination when no status filter is given', async () => {
      const docs = [makeDoc(), makeDoc()];
      const execMock = jest.fn().mockResolvedValue(docs);
      const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: execMock };
      const { Model } = makeModel();
      Model.find = jest.fn().mockReturnValue(chain);

      const service = makeService(Model);
      const result = await service.findAll('org-1', 2, 10);

      expect(Model.find).toHaveBeenCalledWith({ orgId: 'org-1' });
      expect(chain.skip).toHaveBeenCalledWith(10); // page=2, limit=10 → skip=10
      expect(chain.limit).toHaveBeenCalledWith(10);
      expect(result).toEqual(docs);
    });

    it('filters by the given status when one is provided', async () => {
      const docs = [makeDoc()];
      const execMock = jest.fn().mockResolvedValue(docs);
      const chain = { sort: jest.fn().mockReturnThis(), skip: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: execMock };
      const { Model } = makeModel();
      Model.find = jest.fn().mockReturnValue(chain);

      const service = makeService(Model);
      await service.findAll('org-1', 1, 20, TypologyStatus.ACTIVE);

      expect(Model.find).toHaveBeenCalledWith({ orgId: 'org-1', typologyStatus: TypologyStatus.ACTIVE });
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

    it('rejects non-numeric version segment (e.g. v1.1beta)', async () => {
      const doc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'C', version: 'v1.0', fuente: DataSource.MANUAL } });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(service.update('org-1', doc.id, { version: 'v1.1beta' })).rejects.toThrow(BadRequestException);
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

    // Regression (MGESTDOC-59): this explicit pre-check must not depend on the
    // DB unique index actually being built (see onModuleInit's warning) — it
    // has to reject on its own, without ever reaching doc.save().
    it('throws ConflictException — without saving — when the new codigo collides with a different ACTIVE typology', async () => {
      const doc = makeDoc({ datosDeclarados: { nombre: 'P', codigo: 'OLD', version: '01', fuente: DataSource.MANUAL } });
      const { Model } = makeModel(doc);
      const otherActive = makeDoc({ datosDeclarados: { nombre: 'Other', codigo: 'NEW', version: '01', fuente: DataSource.MANUAL } });
      Model.findOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(doc) })         // findOne(orgId, id)
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(otherActive) }); // duplicate pre-check

      const service = makeService(Model);
      await expect(service.update('org-1', doc.id, { codigo: 'NEW' })).rejects.toThrow(ConflictException);
      expect(doc.save).not.toHaveBeenCalled();
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

  // ── findByIdPublic ────────────────────────────────────────────────────────

  describe('findByIdPublic()', () => {
    it('returns a typology by ID', async () => {
      const doc = makeDoc();
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      const result = await service.findByIdPublic('org-1', doc.id);

      expect(result).toBe(doc);
    });

    it('throws BadRequestException for invalid ObjectId', async () => {
      const { Model } = makeModel();
      const service = makeService(Model);

      await expect(service.findByIdPublic('org-1', 'not-an-id')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when typology does not exist', async () => {
      const { Model } = makeModel();
      Model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      const service = makeService(Model);
      const validId = makeId();
      await expect(service.findByIdPublic('org-1', validId)).rejects.toThrow(NotFoundException);
    });
  });

  // ── countOrgStructureReferences ─────────────────────────────────────────────

  describe('countOrgStructureReferences()', () => {
    // Regression: org-service uses this to decide whether a cargo/area/departamento
    // can be safely deleted — undercounting here would let a delete through while a
    // real, non-deleted typology still points at the now-gone id.
    it('counts typologies matching the given cargoId, excluding soft-deleted ones', async () => {
      const { Model } = makeModel();
      Model.countDocuments.mockReturnValue({ exec: jest.fn().mockResolvedValue(3) });
      const service = makeService(Model);

      const count = await service.countOrgStructureReferences('org-1', { cargoId: 'cargo-1' });

      expect(Model.countDocuments).toHaveBeenCalledWith({
        orgId: 'org-1',
        deletedAt: null,
        'estructuraOrg.cargoId': 'cargo-1',
      });
      expect(count).toBe(3);
    });

    it('filters by areaId when given areaId instead of cargoId', async () => {
      const { Model } = makeModel();
      const service = makeService(Model);

      await service.countOrgStructureReferences('org-1', { areaId: 'area-1' });

      expect(Model.countDocuments).toHaveBeenCalledWith({
        orgId: 'org-1',
        deletedAt: null,
        'estructuraOrg.areaId': 'area-1',
      });
    });

    it('filters by departamentoId when given departamentoId', async () => {
      const { Model } = makeModel();
      const service = makeService(Model);

      await service.countOrgStructureReferences('org-1', { departamentoId: 'dept-1' });

      expect(Model.countDocuments).toHaveBeenCalledWith({
        orgId: 'org-1',
        deletedAt: null,
        'estructuraOrg.departamentoId': 'dept-1',
      });
    });

    it.each([TypologyStatus.INCOMPLETE, TypologyStatus.ACTIVE, TypologyStatus.ARCHIVED])(
      'counts a %s typology as a reference (only deletedAt determines existence, not typologyStatus)',
      async (status) => {
        // Not asserting on `status` directly (the filter never includes
        // typologyStatus) — this test documents the intentional decision that
        // INCOMPLETE/ACTIVE/ARCHIVED all block deletion, only a soft-deleted
        // (deletedAt set) typology doesn't.
        const { Model } = makeModel();
        const service = makeService(Model);

        await service.countOrgStructureReferences('org-1', { cargoId: 'cargo-1' });

        const filterArg = Model.countDocuments.mock.calls[0][0];
        expect(filterArg).not.toHaveProperty('typologyStatus');
        expect(filterArg.deletedAt).toBeNull();
      },
    );
  });

  // ── findHistory ───────────────────────────────────────────────────────────

  describe('findHistory()', () => {
    it('returns all typologies with the same codigo (including deleted), capped at 50', async () => {
      const docs = [makeDoc(), makeDoc({ deletedAt: new Date() })];
      const chain = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(docs) };
      const { Model } = makeModel();
      Model.find = jest.fn().mockReturnValue(chain);

      const service = makeService(Model);
      const result = await service.findHistory('org-1', 'POL-001');

      expect(Model.find).toHaveBeenCalledWith({ orgId: 'org-1', 'datosDeclarados.codigo': 'POL-001' });
      expect(chain.limit).toHaveBeenCalledWith(50);
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

    it('trims extracted nombre/codigo/version — a stray space must not look like a discrepancy or a different code', async () => {
      const doc = makeDoc({
        datosDeclarados: { nombre: 'Policy', codigo: 'POL-001', version: '01', fuente: DataSource.MANUAL },
      });
      const { Model } = makeModel(doc);
      Model.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(doc) });

      const service = makeService(Model);
      await service.applyExtractedMetadata('org-1', doc.id, {
        nombre: '  Policy  ', codigo: '  POL-001  ', version: '  01  ',
      });

      expect(doc.metadataExtraida.nombre).toBe('Policy');
      expect(doc.metadataExtraida.codigo).toBe('POL-001');
      expect(doc.metadataExtraida.version).toBe('01');
      expect(doc.metadataExtraida.discrepancias).toHaveLength(0);
      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.COMPLETED);
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
    it('KEEP_DECLARED — does not change datosDeclarados when it already matches the extraction', async () => {
      const doc = makeDoc({
        documento: { extractionStatus: ExtractionStatus.DISCREPANCY, r2Key: null, originalName: null, mimeType: null, uploadedAt: null },
        metadataExtraida: { nombre: 'Policy', codigo: 'POL-001', version: '01', extractedAt: new Date(), discrepancias: [] },
      });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await service.resolveDiscrepancy('org-1', doc.id, { action: ResolveAction.KEEP_DECLARED });

      expect(doc.datosDeclarados.nombre).toBe('Policy');
      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.CONFIRMED);
    });

    it('KEEP_DECLARED — throws when the declared data still mismatches the extracted content', async () => {
      const doc = makeDoc({
        documento: { extractionStatus: ExtractionStatus.DISCREPANCY, r2Key: null, originalName: null, mimeType: null, uploadedAt: null },
        metadataExtraida: { nombre: 'Other', codigo: 'POL-001', version: '01', extractedAt: new Date(), discrepancias: [] },
      });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(
        service.resolveDiscrepancy('org-1', doc.id, { action: ResolveAction.KEEP_DECLARED }),
      ).rejects.toThrow(BadRequestException);
      // Left untouched — still DISCREPANCY, not silently CONFIRMED.
      expect(doc.documento.extractionStatus).toBe(ExtractionStatus.DISCREPANCY);
    });

    it('MANUAL_OVERRIDE — throws when the provided values still mismatch the extracted content', async () => {
      const doc = makeDoc({
        documento: { extractionStatus: ExtractionStatus.DISCREPANCY, r2Key: null, originalName: null, mimeType: null, uploadedAt: null },
        metadataExtraida: { nombre: 'Extracted Name', codigo: 'POL-001', version: '01', extractedAt: new Date(), discrepancias: [] },
      });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await expect(
        service.resolveDiscrepancy('org-1', doc.id, {
          action: ResolveAction.MANUAL_OVERRIDE,
          nombre: 'A Different Name',
        }),
      ).rejects.toThrow(BadRequestException);
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

    it('ADOPT_EXTRACTED — keeps the existing declared value when the extractor found no value for a field, staying ACTIVE instead of silently becoming INCOMPLETE', async () => {
      const doc = makeDoc({
        typologyStatus: TypologyStatus.ACTIVE,
        documento: { extractionStatus: ExtractionStatus.DISCREPANCY, r2Key: null, originalName: null, mimeType: null, uploadedAt: null },
        datosDeclarados: { nombre: 'Policy', codigo: 'POL-001', version: '01', fuente: DataSource.MANUAL },
        // Extractor found a different nombre but couldn't find a version in the document.
        metadataExtraida: { nombre: 'Extracted Name', codigo: 'POL-001', version: null, extractedAt: new Date(), discrepancias: [] },
      });
      const { Model } = makeModel(doc);

      const service = makeService(Model);
      await service.resolveDiscrepancy('org-1', doc.id, { action: ResolveAction.ADOPT_EXTRACTED });

      expect(doc.datosDeclarados.nombre).toBe('Extracted Name');
      expect(doc.datosDeclarados.version).toBe('01'); // preserved, not nulled out
      expect(doc.typologyStatus).toBe(TypologyStatus.ACTIVE); // still complete — doesn't vanish from the active list
    });

    // Regression (MGESTDOC-59): a user blocked at creation for reusing an
    // already-active codigo can get past that check by declaring a
    // different codigo while keeping the same document. The document's real
    // (colliding) content then surfaces as a discrepancy, and adopting the
    // extracted data must still be blocked — it must not depend on the DB
    // unique index actually being built (see onModuleInit's warning), so
    // this checks it explicitly instead of only via the 11000 catch.
    it('ADOPT_EXTRACTED — throws ConflictException — without saving — when the extracted codigo collides with a different ACTIVE typology', async () => {
      const doc = makeDoc({
        documento: { extractionStatus: ExtractionStatus.DISCREPANCY, r2Key: null, originalName: null, mimeType: null, uploadedAt: null },
        datosDeclarados: { nombre: 'Policy', codigo: 'Y', version: '01', fuente: DataSource.MANUAL },
        // The document's real content — what the user was blocked from
        // declaring directly at creation time.
        metadataExtraida: { nombre: 'Policy', codigo: 'X', version: '01', extractedAt: new Date(), discrepancias: [] },
      });
      const { Model } = makeModel(doc);
      const otherActive = makeDoc({ datosDeclarados: { nombre: 'Existing', codigo: 'X', version: '01', fuente: DataSource.MANUAL } });
      Model.findOne
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(doc) })         // findOne(orgId, id)
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(otherActive) }); // duplicate pre-check

      const service = makeService(Model);
      await expect(
        service.resolveDiscrepancy('org-1', doc.id, { action: ResolveAction.ADOPT_EXTRACTED }),
      ).rejects.toThrow(ConflictException);
      expect(doc.save).not.toHaveBeenCalled();
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

  // ── getStats ──────────────────────────────────────────────────────────────

  describe('getStats()', () => {
    it('returns aggregated stats with uploaded documents', async () => {
      const { Model } = makeModel();
      Model.countDocuments = jest.fn()
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(7);
      Model.aggregate = jest.fn()
        .mockResolvedValueOnce([{ uploadedDocuments: 5, storageTotalBytes: 2048 }])
        .mockResolvedValueOnce([
          { _id: 'COMPLETED', count: 3 },
          { _id: 'FAILED',    count: 2 },
        ]);

      const service = makeService(Model);
      const result  = await service.getStats('org-1');

      expect(result.totalTypologies).toBe(10);
      expect(result.activeTypologies).toBe(7);
      expect(result.uploadedDocuments).toBe(5);
      expect(result.storageTotalBytes).toBe(2048);
      expect(result.extractionStatusCounts).toEqual({ COMPLETED: 3, FAILED: 2 });
    });

    it('returns zeros when no documents have been uploaded', async () => {
      const { Model } = makeModel();
      Model.countDocuments = jest.fn()
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(2);
      Model.aggregate = jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const service = makeService(Model);
      const result  = await service.getStats('org-1');

      expect(result.uploadedDocuments).toBe(0);
      expect(result.storageTotalBytes).toBe(0);
      expect(result.extractionStatusCounts).toEqual({});
    });
  });

  // ── getStoragePerOrg ──────────────────────────────────────────────────────

  describe('getStoragePerOrg()', () => {
    it('returns mapped rows from aggregate pipeline', async () => {
      const { Model } = makeModel();
      Model.aggregate = jest.fn().mockResolvedValue([
        { _id: 'org-1', storageTotalBytes: 4096, uploadedDocuments: 3 },
        { _id: 'org-2', storageTotalBytes: 1024, uploadedDocuments: 1 },
      ]);

      const service = makeService(Model);
      const result  = await service.getStoragePerOrg();

      expect(result).toEqual([
        { orgId: 'org-1', storageTotalBytes: 4096, uploadedDocuments: 3 },
        { orgId: 'org-2', storageTotalBytes: 1024, uploadedDocuments: 1 },
      ]);
    });

    it('returns empty array when no orgs have documents', async () => {
      const { Model } = makeModel();
      Model.aggregate = jest.fn().mockResolvedValue([]);

      const service = makeService(Model);
      const result  = await service.getStoragePerOrg();

      expect(result).toEqual([]);
    });
  });
});

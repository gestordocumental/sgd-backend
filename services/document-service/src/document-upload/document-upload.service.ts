import { Injectable, NotFoundException, BadRequestException, ConflictException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Typology, TypologyDocument, ExtractionStatus, TypologyStatus } from '../typologies/schemas/typology.schema';
import { StorageService } from '../common/storage/storage.service';
import { AppLogger, KafkaProducerService, TOPICS, getClientIp, getCorrelationId } from '@sgd/common';
import { TypologyResponseDto } from '../typologies/dto/typology-response.dto';
import { ALLOWED_MIMETYPES, MAX_FILE_SIZE, validateMagicBytes } from './document-upload.constants';
import { ClamavService } from '../clamav/clamav.service';

/**
 * Determine whether `newVer` is exactly one incremental bump above `oldVer`.
 *
 * Leading `v`/`V` prefixes are ignored; both versions must be numeric dotted sequences (e.g. `1.2.3`).
 * The first differing segment must equal the corresponding old segment plus one, and every segment to the right must be `0`.
 *
 * Examples: "05" → "06" ✓, "v1.0" → "v1.1" ✓, "v1.9" → "v2.0" ✓, "v1.0" → "v2.1" ✗
 *
 * @returns `true` if `newVer` increases `oldVer` by exactly one at the first differing numeric segment with all lower segments reset to `0`, `false` otherwise.
 */
function isExactlyOneIncrement(newVer: string, oldVer: string): boolean {
  const parse = (v: string): number[] | null => {
    const normalized = v.replace(/^v/i, '');
    // eslint-disable-next-line security/detect-unsafe-regex
    if (!/^\d+(\.\d+)*$/.test(normalized)) return null;
    return normalized.split('.').map((n) => Number(n));
  };
  const nv = parse(newVer);
  const ov = parse(oldVer);
  if (!nv || !ov) return false;
  const len = Math.max(nv.length, ov.length);
  while (nv.length < len) nv.push(0);
  while (ov.length < len) ov.push(0);

  let diffIdx = -1;
  for (let i = 0; i < len; i++) {
    if (nv[i] !== ov[i]) { diffIdx = i; break; }
  }
  if (diffIdx === -1) return false;                      // same version
  if (nv[diffIdx] !== ov[diffIdx] + 1) return false;    // must be exactly +1
  for (let i = diffIdx + 1; i < len; i++) {
    if (nv[i] !== 0) return false;                       // lower segments must reset to 0
  }
  return true;
}


@Injectable()
export class DocumentUploadService {
  // Bounds how long an extraction may sit in PROCESSING before a manual
  // retry is allowed to interrupt it. Normally extraction completes within
  // seconds/low minutes; anything stuck longer than this is treated as
  // abandoned — whether because Kafka never delivered the event, the
  // extraction consumer crashed mid-run, or upload()'s/createNewVersion()'s
  // own compensating write (meant to flip this to FAILED on a Kafka
  // failure) itself failed to persist. That last case used to leave a
  // typology PERMANENTLY stuck: retryExtraction() only ever accepted
  // FAILED, so once the compensating write failed too, nothing could ever
  // unblock it via the API. Anchored to documento.uploadedAt rather than a
  // dedicated "extraction started at" field — good enough since
  // retryExtraction() is a deliberate, infrequent admin action, not
  // something that fires automatically and races itself.
  private static readonly STUCK_EXTRACTION_THRESHOLD_MS = 15 * 60 * 1000;

  constructor(
    @InjectModel(Typology.name)
    private readonly model: Model<TypologyDocument>,
    private readonly storage: StorageService,
    private readonly kafka: KafkaProducerService,
    private readonly logger: AppLogger,
    private readonly clamav: ClamavService,
  ) {}

  private async assertMalwareFree(buffer: Buffer): Promise<void> {
    const scanResult = await this.clamav.scan(buffer);
    if (!scanResult.clean) {
      const threat = scanResult.threat ?? 'unknown';
      throw new BadRequestException({
        message: `File rejected: malware detected (${threat}).`,
        errorCode: 'MALWARE_DETECTED',
      });
    }
  }

  private emitAuditLog(params: {
    actorId: string;
    orgId: string;
    action: string;
    resourceId: string;
    resourceName?: string;
    metadata?: Record<string, unknown>;
  }): void {
    this.kafka.emitSafe(TOPICS.AUDIT_LOG, {
      service:       'document-service',
      actorId:       params.actorId,
      orgId:         params.orgId,
      action:        params.action,
      resourceType:  'document',
      resourceId:    params.resourceId,
      resourceName:  params.resourceName ?? null,
      correlationId: getCorrelationId(),
      ip:            getClientIp(),
      metadata:      params.metadata ?? null,
      timestamp:     new Date().toISOString(),
    });
  }

  async upload(
    orgId: string,
    typologyId: string,
    file: Express.Multer.File,
    orgName?: string,
    actorId?: string,
  ): Promise<{ message: string; extractionStatus: string }> {
    if (!Types.ObjectId.isValid(typologyId)) throw new BadRequestException('Invalid typology ID');

    const typology = await this.model.findOne({ _id: typologyId, orgId, deletedAt: null }).exec();
    if (!typology) throw new NotFoundException(`Typology ${typologyId} not found`);

    const ext = ALLOWED_MIMETYPES[file.mimetype];
    if (!ext) throw new BadRequestException('Format not allowed. Use PDF, DOCX or XLSX.');

    if (file.size > MAX_FILE_SIZE) throw new BadRequestException('File exceeds the maximum allowed size of 20 MB.');

    if (!validateMagicBytes(file.buffer, file.mimetype))
      throw new BadRequestException({ message: 'File content does not match declared type.', errorCode: 'FILE_CONTENT_MISMATCH' });

    await this.assertMalwareFree(file.buffer);

    const previousDoc = typology.documento?.r2Key ? { ...typology.documento } : null;
    const r2Key = `org/${orgId}/typologies/${typologyId}/${uuidv4()}.${ext}`;

    // Step 1: Upload new file — if this fails, nothing in DB has changed yet.
    await this.storage.upload(r2Key, file.buffer, file.mimetype);

    // Step 2: Persist new state — if this fails, delete the orphaned upload.
    typology.documento = {
      r2Key,
      originalName:        file.originalname,
      mimeType:            file.mimetype,
      uploadedAt:          new Date(),
      extractionStatus:    ExtractionStatus.PROCESSING,
      extractionStartedAt: new Date(),
      sizeBytes:           file.size ?? null,
    };

    try {
      await typology.save();
    } catch (err) {
      await this.storage.delete(r2Key).catch(() => {});
      throw err;
    }

    // Step 3: Emit extraction event. A rejected producer.send() doesn't prove
    // Kafka never got the message — the ack round-trip can fail after a
    // successful write — so this must NOT revert to the previous document or
    // delete the new file: that would risk leaving a dangling reference for
    // an event the extraction consumer actually received (it downloads by
    // r2Key). The new document is already durably persisted (Step 2)
    // regardless of this outcome, so on failure this only marks extraction
    // FAILED and leaves recovery to the existing retryExtraction() flow —
    // the same repair path already used for any other extraction failure.
    try {
      await this.kafka.emit(TOPICS.TYPOLOGY_FILE_UPLOADED, {
        orgId,
        typologyId,
        r2Key,
        mimeType: file.mimetype,
        ...(orgName ? { orgName } : {}),
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit extraction event for typology ${typologyId} (org ${orgId}); delivery is ` +
          'unconfirmed either way, so the uploaded document is kept as-is instead of being rolled back — ' +
          `only extractionStatus is set to FAILED. Retry extraction manually. Cause: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
        'DocumentUploadService',
      );
      typology.documento.extractionStatus = ExtractionStatus.FAILED;
      const persisted = await typology.save().then(() => true).catch((saveErr: unknown) => {
        this.logger.error(
          `Failed to persist extractionStatus=FAILED for typology ${typologyId} after the Kafka emit ` +
            'failure above — the DB still shows PROCESSING. Blocked: retryExtraction() requires the ' +
            `persisted status to already be FAILED. Cause: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
          saveErr instanceof Error ? saveErr.stack : undefined,
          'DocumentUploadService',
        );
        return false;
      });
      // Never claim a status that didn't actually make it to the DB — revert
      // the in-memory value back to what's really persisted (PROCESSING,
      // from Step 2's earlier successful save) so the response below and
      // any other reader agree with reality instead of an aspiration.
      if (!persisted) typology.documento.extractionStatus = ExtractionStatus.PROCESSING;
    }

    // Step 4: Delete the previous file — safe regardless of Step 3's outcome,
    // since typology.documento already points at the new file either way.
    if (previousDoc?.r2Key) {
      await this.storage.delete(previousDoc.r2Key).catch(() => {});
    }

    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'TYPOLOGY_DOCUMENT_UPLOADED', resourceId: typologyId, resourceName: typology.datosDeclarados.nombre ?? typology.datosDeclarados.codigo ?? undefined, metadata: { mimeType: file.mimetype, originalName: file.originalname } });
    }

    const extractionStatus = typology.documento.extractionStatus;
    const message = extractionStatus === ExtractionStatus.FAILED
      ? 'Document uploaded, but metadata extraction could not be triggered. Retry extraction.'
      : 'Document uploaded. Metadata extraction in progress.';

    this.logger.log(
      `Document uploaded for typology ${typologyId}, extraction ${extractionStatus === ExtractionStatus.FAILED ? 'failed to start' : 'started'}`,
      'DocumentUploadService',
    );

    return { message, extractionStatus };
  }

  /**
   * Best-effort restore of `old` back to ACTIVE after a later step in
   * createNewVersion() fails — old is archived early there (see that
   * method's step-ordering comment), so every rollback branch after that
   * point needs to undo it. Logs loudly instead of silently swallowing a
   * failure here: unlike a failed cleanup of the new doc/file (merely
   * orphaned resources), a failed restore leaves the org with a codigo that
   * has NO active typology at all until someone notices.
   */
  private async restoreOldActive(old: TypologyDocument, typologyId: string): Promise<void> {
    old.typologyStatus = TypologyStatus.ACTIVE;
    old.pendingVersionTransition = null;
    const restored = await old.save().then(() => true).catch(() => false);
    if (!restored) {
      this.logger.error(
        `Failed to restore typology ${typologyId} to ACTIVE after a new-version rollback; ` +
          'it is stuck ARCHIVED with no active replacement. Needs manual intervention.',
        undefined,
        'DocumentUploadService',
      );
    }
  }

  /**
   * Rollback used by createNewVersion()'s Step 3/4 catch blocks. By the time
   * either runs, newDoc was already persisted ACTIVE in Step 2, sharing
   * old's codigo — so restoring old to ACTIVE is only safe once newDoc is
   * actually gone; the unique-active-codigo index forbids both being ACTIVE
   * at once. If newDoc.deleteOne() itself fails, calling restoreOldActive()
   * anyway would just make old.save() collide on that same index and fail —
   * a wasted call whose failure path (restoreOldActive's own log) wrongly
   * claims "no active replacement", when in fact a broken, document-less
   * newDoc is silently squatting on the ACTIVE slot for this codigo. So this
   * only restores old once the delete is confirmed, and otherwise logs the
   * real state (newDoc, not old, is what needs manual cleanup) instead of
   * that misleading message.
   */
  private async rollbackFailedVersionWrite(
    newDoc: TypologyDocument,
    old: TypologyDocument,
    typologyId: string,
    newTypologyId: string,
  ): Promise<void> {
    // Checking the promise resolved isn't enough — deleteOne() resolves with
    // { acknowledged, deletedCount } even on an unacknowledged write (w: 0),
    // which doesn't confirm the delete actually persisted. acknowledged is
    // the right check, not deletedCount === 1: deletedCount === 0 with
    // acknowledged: true just means newDoc was already gone (e.g. a prior
    // partial retry), which is equally safe to proceed on.
    const deleted = await newDoc.deleteOne()
      .then((result) => result.acknowledged)
      .catch(() => false);
    if (deleted) {
      await this.restoreOldActive(old, typologyId);
      return;
    }
    this.logger.error(
      `Failed to delete the broken new version ${newTypologyId} after a version-bump rollback — it is ` +
        `left ACTIVE with codigo '${old.datosDeclarados.codigo}' but no usable document, and typology ` +
        `${typologyId} was intentionally left ARCHIVED instead of restoring it to ACTIVE (which would ` +
        'collide with that same codigo on the unique-active-codigo index and fail anyway). Needs manual ' +
        `intervention: delete or fix ${newTypologyId} directly, then restore ${typologyId} to ACTIVE.`,
      undefined,
      'DocumentUploadService',
    );
  }

  /**
   * Archives the current typology and creates a new one with the same codigo,
   * uploads the provided file and triggers metadata extraction.
   * The new version must be strictly greater than the current one (if both are set).
   */
  async createNewVersion(
    orgId: string,
    typologyId: string,
    file: Express.Multer.File,
    dto: { nombre?: string; version?: string; orgName?: string; actorId?: string },
  ): Promise<TypologyResponseDto> {
    if (!Types.ObjectId.isValid(typologyId)) throw new BadRequestException('Invalid typology ID');

    const old = await this.model.findOne({ _id: typologyId, orgId, deletedAt: null }).exec();
    if (!old) throw new NotFoundException(`Typology ${typologyId} not found`);

    // These arrive as raw multipart fields (no DTO/@Transform pipeline), unlike
    // create/update — trim so a stray space doesn't make this look like a
    // different code/version to Mongo's unique index than the one it's replacing.
    dto = {
      ...dto,
      nombre:  dto.nombre?.trim()  || undefined,
      version: dto.version?.trim() || undefined,
    };

    const ext = ALLOWED_MIMETYPES[file.mimetype];
    if (!ext) throw new BadRequestException('Format not allowed. Use PDF, DOCX or XLSX.');
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException('File exceeds the maximum allowed size of 20 MB.');

    if (!validateMagicBytes(file.buffer, file.mimetype))
      throw new BadRequestException({ message: 'File content does not match declared type.', errorCode: 'FILE_CONTENT_MISMATCH' });

    await this.assertMalwareFree(file.buffer);

    const newVersion = dto.version ?? null;
    const oldVersion = old.datosDeclarados.version;

    if (newVersion && oldVersion && !isExactlyOneIncrement(newVersion, oldVersion)) {
      throw new BadRequestException(
        `The new version (${newVersion}) must be exactly one increment above the current version (${oldVersion}).`,
      );
    }

    const nombre  = dto.nombre  !== undefined ? dto.nombre  : old.datosDeclarados.nombre;
    const version = newVersion  !== null       ? newVersion  : old.datosDeclarados.version;
    const codigo  = old.datosDeclarados.codigo;
    const hasDeclaredData = !!(nombre && codigo && version);

    // Pre-generated so it can be named in old's pending-transition marker
    // (Step 1) before newDoc itself is created (Step 2) — see
    // PendingVersionTransition's docstring for why this two-write sequence
    // needs one at all.
    const newTypologyObjectId = new Types.ObjectId();
    const newTypologyId = newTypologyObjectId.toString();

    // Step 1: Archive old FIRST — it shares codigo with the new doc, and the
    // unique-active-codigo index (typology.schema.ts) allows only one ACTIVE
    // document per (orgId, codigo). Creating newDoc as ACTIVE (below) while
    // old was still ACTIVE used to collide with itself on every single-step
    // version bump of an already-complete typology — this was an
    // unconditional failure, not a rare race. If this save fails, nothing
    // else has happened yet. The pending-transition marker is set in this
    // same single-document write (atomic together with the archive) so a
    // process crash right after this line has something durable to recover
    // from — see reconcilePendingVersionTransitions() in TypologiesService.
    old.typologyStatus = TypologyStatus.ARCHIVED;
    old.pendingVersionTransition = { newTypologyId, startedAt: new Date() };
    await old.save();

    // Step 2: Create new typology — now safe to go ACTIVE. If this fails,
    // restore old to ACTIVE so the org is never left without one.
    const newDoc = new this.model({
      _id: newTypologyObjectId,
      orgId,
      typologyStatus:  hasDeclaredData ? TypologyStatus.ACTIVE : TypologyStatus.INCOMPLETE,
      fuenteCreacion:  old.fuenteCreacion,
      estructuraOrg: {
        departamentoId:     old.estructuraOrg.departamentoId,
        departamentoNombre: old.estructuraOrg.departamentoNombre,
        areaId:             old.estructuraOrg.areaId,
        areaNombre:         old.estructuraOrg.areaNombre,
        cargoId:            old.estructuraOrg.cargoId,
        cargoNombre:        old.estructuraOrg.cargoNombre,
      },
      datosDeclarados: { nombre, codigo, version, fuente: old.datosDeclarados.fuente },
    });

    try {
      await newDoc.save();
    } catch (err: any) {
      await this.restoreOldActive(old, typologyId);
      if (err?.code === 11000) {
        throw new ConflictException({
          message: `An active typology with code '${codigo}' already exists in this organization. Only one active typology per code is allowed.`,
          errorCode: 'TYPOLOGY_CODE_ALREADY_EXISTS',
          params: { codigo },
        });
      }
      throw err;
    }

    const r2Key = `org/${orgId}/typologies/${newTypologyId}/${uuidv4()}.${ext}`;

    // Step 3: Upload file — if this fails, delete newDoc and restore old to ACTIVE.
    try {
      await this.storage.upload(r2Key, file.buffer, file.mimetype);
    } catch (err) {
      await this.rollbackFailedVersionWrite(newDoc, old, typologyId, newTypologyId);
      throw err;
    }

    // Step 4: Persist documento on new doc — if this fails, clean up file + newDoc + restore old.
    newDoc.documento = {
      r2Key,
      originalName:        file.originalname,
      mimeType:            file.mimetype,
      uploadedAt:          new Date(),
      extractionStatus:    ExtractionStatus.PROCESSING,
      extractionStartedAt: new Date(),
      sizeBytes:           file.size ?? null,
    };

    try {
      await newDoc.save();
    } catch (err) {
      await this.storage.delete(r2Key).catch(() => {});
      await this.rollbackFailedVersionWrite(newDoc, old, typologyId, newTypologyId);
      throw err;
    }

    // newDoc is now fully written (documento.r2Key set) — the transition is
    // logically complete regardless of Step 5's outcome below (Kafka
    // delivery is an orthogonal, already-recoverable concern — see
    // retryExtraction()). Clear old's pending-transition marker so a later
    // startup reconciliation sweep doesn't need to touch this typology at
    // all. Best-effort: if this particular save fails, the marker is simply
    // still present at next startup, where reconcilePendingVersionTransitions()
    // finds newDoc already fully written and just clears it then — nothing
    // is lost, this is a pure bookkeeping cleanup, not a correctness gate.
    old.pendingVersionTransition = null;
    await old.save().catch((err: unknown) => {
      this.logger.warn(
        `Could not clear the pending-transition marker on typology ${typologyId} after new version ` +
          `${newTypologyId} was fully created; harmless — the next service startup will clear it. ` +
          `Cause: ${err instanceof Error ? err.message : String(err)}`,
        'DocumentUploadService',
      );
    });

    // Step 5: Emit extraction event. Unlike steps 2-4, a failure here does NOT
    // roll back the version bump. producer.send() rejecting doesn't prove the
    // broker never got the message — the ack round-trip can fail after a
    // successful write — so deleting newDoc/r2Key on a mere send() rejection
    // would risk leaving a dangling reference for an event that was actually
    // delivered (the extraction consumer downloads the file by r2Key). By
    // this point newDoc is already the real ACTIVE typology and old is
    // already ARCHIVED — both correctly reflect reality regardless of
    // whether this specific event landed. So on failure this only marks
    // extraction FAILED and leaves recovery to the existing
    // retryExtraction() flow — the same repair path already used for any
    // other extraction failure — instead of destroying data that might
    // still be referenced by a delivered message.
    try {
      await this.kafka.emit(TOPICS.TYPOLOGY_FILE_UPLOADED, {
        orgId,
        typologyId: newTypologyId,
        r2Key,
        mimeType: file.mimetype,
        ...(dto.orgName ? { orgName: dto.orgName } : {}),
      });
    } catch (err) {
      this.logger.error(
        `Failed to emit extraction event for new typology version ${newTypologyId} ` +
          `(org ${orgId}, previous version ${typologyId}); delivery is unconfirmed either way, so the ` +
          'version bump is kept as-is instead of being rolled back — only extractionStatus is set to ' +
          `FAILED. Retry extraction manually. Cause: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err.stack : undefined,
        'DocumentUploadService',
      );
      newDoc.documento.extractionStatus = ExtractionStatus.FAILED;
      const persisted = await newDoc.save().then(() => true).catch((saveErr: unknown) => {
        this.logger.error(
          `Failed to persist extractionStatus=FAILED for new typology version ${newTypologyId} after ` +
            'the Kafka emit failure above — the DB still shows PROCESSING. Blocked: retryExtraction() ' +
            `requires the persisted status to already be FAILED. Cause: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
          saveErr instanceof Error ? saveErr.stack : undefined,
          'DocumentUploadService',
        );
        return false;
      });
      // Never claim a status that didn't actually make it to the DB — revert
      // the in-memory value back to what's really persisted (PROCESSING,
      // from Step 4's earlier successful save) so the returned DTO agrees
      // with reality instead of an aspiration.
      if (!persisted) newDoc.documento.extractionStatus = ExtractionStatus.PROCESSING;
    }

    if (dto.actorId) {
      this.emitAuditLog({
        actorId:      dto.actorId,
        orgId,
        action:       'TYPOLOGY_VERSION_CREATED',
        resourceId:   newTypologyId,
        resourceName: nombre ?? codigo ?? undefined,
        metadata:     { previousTypologyId: typologyId, oldVersion: oldVersion ?? null, newVersion: version ?? null },
      });
    }

    this.logger.log(
      `New version created: ${typologyId} (${oldVersion ?? '—'}) → ${newTypologyId} (${version ?? '—'})`,
      'DocumentUploadService',
    );

    return TypologyResponseDto.fromDocument(newDoc);
  }

  async getSignedUrl(
    orgId: string,
    typologyId: string,
  ): Promise<{ signedUrl: string; expiresAt: Date }> {
    if (!Types.ObjectId.isValid(typologyId)) throw new BadRequestException('Invalid typology ID');

    const typology = await this.model.findOne({ _id: typologyId, orgId, deletedAt: null }).exec();
    if (!typology) throw new NotFoundException(`Typology ${typologyId} not found`);
    if (!typology.documento?.r2Key) throw new NotFoundException('Esta tipología no tiene documento cargado');

    const { url, expiresAt } = await this.storage.getSignedDownloadUrl(
      typology.documento.r2Key,
      typology.documento.originalName ?? undefined,
      typology.documento.mimeType    ?? undefined,
    );
    return { signedUrl: url, expiresAt };
  }

  async retryExtraction(
    orgId: string,
    typologyId: string,
    orgName?: string,
    actorId?: string,
  ): Promise<{ message: string; extractionStatus: string }> {
    if (!Types.ObjectId.isValid(typologyId)) throw new BadRequestException('Invalid typology ID');

    const existing = await this.model.findOne({ _id: typologyId, orgId, deletedAt: null }).exec();
    if (!existing) throw new NotFoundException(`Typology ${typologyId} not found`);
    if (!existing.documento?.r2Key) throw new BadRequestException('Esta tipología no tiene documento cargado');

    // Claims this attempt with a single atomic conditional update, not a
    // separate read-then-save: two concurrent retryExtraction() calls could
    // otherwise both load the same FAILED/stuck-PROCESSING state, both pass
    // a plain in-memory precondition check, and both save()+emit — a
    // genuine double-fire, not just a sequential-retry issue (that part was
    // already closed by re-claiming extractionStartedAt, but only helped
    // against a second call *after* the first one's save() had already
    // committed, not two calls racing each other). findOneAndUpdate()'s
    // filter re-encodes the same precondition (FAILED, or PROCESSING but
    // stuck past the threshold — see STUCK_EXTRACTION_THRESHOLD_MS) so only
    // one of two racing calls can match-and-update in the same operation;
    // Mongo guarantees that atomically at the single-document level, no
    // transaction/lock needed. `extractionStartedAt: { $ne: null, $lt }`
    // deliberately excludes null — BSON sorts Null before Date, so a bare
    // `$lt` would otherwise treat "never started" as "infinitely stuck".
    const stuckThreshold = new Date(Date.now() - DocumentUploadService.STUCK_EXTRACTION_THRESHOLD_MS);
    const typology = await this.model.findOneAndUpdate(
      {
        _id: typologyId,
        orgId,
        deletedAt: null,
        $or: [
          { 'documento.extractionStatus': ExtractionStatus.FAILED },
          {
            'documento.extractionStatus': ExtractionStatus.PROCESSING,
            'documento.extractionStartedAt': { $ne: null, $lt: stuckThreshold },
          },
        ],
      },
      {
        $set: {
          'documento.extractionStatus': ExtractionStatus.PROCESSING,
          'documento.extractionStartedAt': new Date(),
        },
      },
      { new: true },
    ).exec();

    if (!typology) {
      // Either genuinely not retriable, or a concurrent call already
      // claimed it a moment ago — both look the same from here, and both
      // get the same "try again" message. `existing` is a best-effort,
      // slightly-stale read only used to describe the state in the message.
      throw new BadRequestException(
        `Solo se puede reintentar cuando la extracción ha fallado. Estado actual: ${existing.documento.extractionStatus}`,
      );
    }

    try {
      await this.kafka.emit(TOPICS.TYPOLOGY_FILE_UPLOADED, {
        orgId,
        typologyId,
        r2Key:    typology.documento.r2Key,
        mimeType: typology.documento.mimeType,
        ...(orgName ? { orgName } : {}),
      });
    } catch (err) {
      typology.documento.extractionStatus = ExtractionStatus.FAILED;
      await typology.save().catch((saveErr: unknown) => {
        this.logger.error(
          `Failed to revert extractionStatus back to FAILED for typology ${typologyId} after a retry's ` +
            'Kafka emit failed — the DB is stuck showing PROCESSING, so a future retryExtraction() call ' +
            `will also reject (it requires the persisted status to already be FAILED). Cause: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
          saveErr instanceof Error ? saveErr.stack : undefined,
          'DocumentUploadService',
        );
      });
      throw new InternalServerErrorException('No se pudo reencolar la extracción. Intenta de nuevo.');
    }

    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'TYPOLOGY_EXTRACTION_RETRIED', resourceId: typologyId, resourceName: typology.datosDeclarados.nombre ?? typology.datosDeclarados.codigo ?? undefined });
    }

    this.logger.log(`Extraction retried for typology ${typologyId}`, 'DocumentUploadService');
    return { message: 'Extracción reencolada.', extractionStatus: ExtractionStatus.PROCESSING };
  }
}

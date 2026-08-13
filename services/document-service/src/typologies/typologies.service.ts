import {
  Injectable, NotFoundException, ConflictException, BadRequestException,
  ServiceUnavailableException, OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import * as Sentry from '@sentry/node';
import {
  Typology, TypologyDocument, TypologyStatus, ExtractionStatus, DataSource, CreationSource,
} from './schemas/typology.schema';
import { CreateTypologyDto } from './dto/create-typology.dto';
import { UpdateTypologyDto } from './dto/update-typology.dto';
import { ResolveDiscrepancyDto, ResolveAction } from './dto/resolve-discrepancy.dto';
import { KafkaProducerService, TOPICS, getClientIp, getCorrelationId, AppLogger } from '@sgd/common';

/**
 * Determines whether `newVer` represents exactly a +1 increment over `oldVer` at the first differing segment, with all subsequent segments in `newVer` equal to zero.
 *
 * @param newVer - New dotted version string (optionally prefixed with `v`, e.g. `v1.2.0`)
 * @param oldVer - Old dotted version string (optionally prefixed with `v`)
 * @returns `true` if the first differing segment in `newVer` equals the corresponding segment in `oldVer` plus one and every following segment in `newVer` is `0`, `false` otherwise.
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
  if (diffIdx === -1) return false;
  if (nv[diffIdx] !== ov[diffIdx] + 1) return false;
  for (let i = diffIdx + 1; i < len; i++) {
    if (nv[i] !== 0) return false;
  }
  return true;
}

/**
 * Trims a string value, collapsing an empty result to null. Used to normalize
 * metadata coming from the extractor/upload paths, which — unlike the
 * create/update DTOs — aren't run through class-transformer's @Transform.
 * Without this, "D-MS-F-012" and "D-MS-F-012 " are distinct strings to Mongo's
 * unique index, letting two "active" typologies for the same code coexist.
 */
function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface OrgStructureNames {
  departamentoId: string;
  departamentoNombre: string;
  areaId?: string | null;
  areaNombre?: string | null;
  cargoId?: string | null;
  cargoNombre?: string | null;
}

@Injectable()
export class TypologiesService implements OnModuleInit {
  // Flipped to false if syncIndexes() (below) can't confirm the
  // unique-active-codigo index is actually built. assertNoActiveDuplicateCodigo()
  // fails closed on it — see that method's docstring for why a pre-check
  // read alone can't safely stand in for the index. No auto-recovery: the
  // documented remediation is fixing the underlying duplicate data and
  // restarting the service, which re-runs onModuleInit() and clears this.
  private codigoUniquenessEnforced = true;

  constructor(
    @InjectModel(Typology.name)
    private readonly model: Model<TypologyDocument>,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Mongoose's default autoIndex silently fails to build an index if existing
   * documents already violate it (e.g. duplicate ACTIVE typologies for the same
   * codigo) — the app boots normally and the constraint is just never enforced,
   * with nothing but an unlistened connection event to show for it. Forcing an
   * explicit syncIndexes() here surfaces that failure loudly instead.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.model.syncIndexes();
    } catch (err) {
      this.codigoUniquenessEnforced = false;
      Sentry.captureException(err);
      this.logger.error(
        'Failed to sync typology indexes — the unique-active-codigo constraint may not be enforced. ' +
          'This usually means duplicate ACTIVE typologies already exist for the same (orgId, codigo); ' +
          'find and resolve them, then restart this service. Blocking typology writes that would rely ' +
          'on this constraint (create/update/resolveDiscrepancy with a codigo) until then.',
        err instanceof Error ? err.stack : String(err),
        'TypologiesService',
      );
    }

    await this.reconcilePendingVersionTransitions();
  }

  /**
   * Repairs DocumentUploadService.createNewVersion() transitions left
   * incomplete by a process crash between archiving the old typology and
   * the new one being fully written — see PendingVersionTransition's
   * docstring in typology.schema.ts for the full reasoning. Runs once at
   * startup: no cron/scheduler infra exists anywhere in this codebase, and
   * a crashed instance restarting is exactly the moment a stuck transition
   * is most likely to exist, so this is the natural place for it rather
   * than adding new infrastructure.
   *
   * At startup nothing has accepted traffic yet, so any marker found here
   * cannot belong to an operation that's still legitimately in flight — its
   * presence alone means the normal completion path (which always clears
   * it, on both success and every rollback branch) never ran.
   */
  private async reconcilePendingVersionTransitions(): Promise<void> {
    const stuck = await this.model.find({ pendingVersionTransition: { $ne: null } }).exec();
    for (const doc of stuck) {
      const newTypologyId = doc.pendingVersionTransition?.newTypologyId;
      try {
        // Fully written == documento.r2Key set — the same signal
        // createNewVersion() itself uses to decide the transition
        // succeeded. If true, the crash only hit the marker-clear step
        // afterwards; the new version is real and must be left alone.
        const newDocFullyWritten = newTypologyId
          ? await this.model.findOne({
              _id: newTypologyId,
              orgId: doc.orgId,
              deletedAt: null,
              'documento.r2Key': { $ne: null },
            }).exec()
          : null;

        if (newDocFullyWritten) {
          doc.pendingVersionTransition = null;
          await doc.save();
          this.logger.log(
            `Cleared a stale version-transition marker on typology ${doc.id}; new version ` +
              `${newTypologyId} was already fully written — nothing else to do.`,
            'TypologiesService',
          );
        } else {
          // Delete the partial newDoc BEFORE restoring old/clearing the marker
          // (not best-effort/swallowed) — if this fails, the catch block below
          // must see it and leave the marker in place, so the sweep on the
          // NEXT startup finds this doc again and retries the cleanup.
          // Clearing the marker regardless (the old ordering) would silently
          // orphan newDoc forever the moment this delete has a transient
          // failure: nothing else is watching for it once the marker is gone.
          if (newTypologyId) {
            // Checking the promise resolved isn't enough — deleteOne() can
            // resolve with { acknowledged: false } instead of rejecting on an
            // unacknowledged write, which doesn't confirm the delete actually
            // persisted. Throwing here (caught below, same as an outright
            // rejection) keeps the marker in place for the next startup's
            // sweep to retry, instead of proceeding as if it succeeded.
            // deletedCount === 0 alongside acknowledged: true is NOT a
            // failure case — it just means newDoc was already gone (which
            // includes having been legitimately soft-deleted by a user in
            // the meantime — deletedAt: null below is required so this
            // never hard-deletes a real, already-soft-deleted historical
            // record; findHistory() still needs to be able to show it).
            const result = await this.model.deleteOne({
              _id: newTypologyId,
              orgId: doc.orgId,
              deletedAt: null,
            }).exec();
            if (!result.acknowledged) {
              throw new Error(`deleteOne for typology ${newTypologyId} was not acknowledged`);
            }
          }
          doc.typologyStatus = TypologyStatus.ACTIVE;
          doc.pendingVersionTransition = null;
          await doc.save();
          Sentry.captureMessage(
            `Reconciled an interrupted typology version transition on startup: ${doc.id}`,
            'warning',
          );
          this.logger.warn(
            `Reconciled an interrupted version transition on startup — restored typology ${doc.id} to ` +
              `ACTIVE (the pending new version ${newTypologyId ?? '(unknown)'} never finished writing). ` +
              'If a file was uploaded to storage for the discarded attempt, it is orphaned there — ' +
              'harmless (no longer referenced by any document) but not automatically cleaned up.',
            'TypologiesService',
          );
        }
      } catch (err) {
        Sentry.captureException(err);
        this.logger.error(
          `Failed to reconcile pending version transition on typology ${doc.id}; it may still be ` +
            'stuck ARCHIVED with no active replacement. Needs manual intervention.',
          err instanceof Error ? err.stack : String(err),
          'TypologiesService',
        );
      }
    }
  }

  /**
   * Explicit pre-check for "only one ACTIVE typology per (orgId, codigo)".
   * On its own this is a plain read-then-write: two concurrent requests can
   * both read "no duplicate" and both proceed to save, so it CANNOT
   * guarantee the constraint by itself. The actual guarantee comes from
   * MongoDB's own unique index, enforced atomically at write time
   * (surfaced here as a caught 11000 error in every write path below) —
   * this pre-check only exists to turn that into a clean ConflictException
   * instead of a raw duplicate-key error reaching the caller. Write paths
   * that skip this explicit check and rely solely on the 11000 catch — as
   * update()/resolveDiscrepancy() used to — have zero protection once the
   * index is missing: doc.save() just succeeds, silently leaving two ACTIVE
   * typologies with the same codigo.
   *
   * So if syncIndexes() couldn't confirm the index is actually built
   * (codigoUniquenessEnforced), this read can no longer be trusted as even
   * a best-effort check — fail closed instead of silently accepting an
   * unbounded race window.
   */
  private async assertNoActiveDuplicateCodigo(
    orgId: string,
    codigo: string | null | undefined,
    excludeId?: Types.ObjectId,
  ): Promise<void> {
    if (!codigo) return;
    if (!this.codigoUniquenessEnforced) {
      throw new ServiceUnavailableException({
        message: 'Typology creation/update is temporarily unavailable: the active-codigo uniqueness constraint could not be verified. Contact an administrator.',
        errorCode: 'TYPOLOGY_UNIQUENESS_UNAVAILABLE',
      });
    }
    const filter: FilterQuery<TypologyDocument> = {
      orgId,
      'datosDeclarados.codigo': codigo,
      typologyStatus: TypologyStatus.ACTIVE,
    };
    if (excludeId) filter._id = { $ne: excludeId };
    const existing = await this.model.findOne(filter).exec();
    if (existing) {
      throw new ConflictException({
        message: `An active typology with code '${codigo}' already exists in this organization. Only one active typology per code is allowed.`,
        errorCode: 'TYPOLOGY_CODE_ALREADY_EXISTS',
        params: { codigo },
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
    this.kafkaProducer.emitSafe(TOPICS.AUDIT_LOG, {
      service:       'document-service',
      actorId:       params.actorId,
      orgId:         params.orgId,
      action:        params.action,
      resourceType:  'typology',
      resourceId:    params.resourceId,
      resourceName:  params.resourceName ?? null,
      correlationId: getCorrelationId(),
      ip:            getClientIp(),
      metadata:      params.metadata ?? null,
      timestamp:     new Date().toISOString(),
    });
  }

  async create(
    orgId: string,
    dto: CreateTypologyDto,
    structureNames: OrgStructureNames,
    source: CreationSource = CreationSource.MANUAL,
    actorId?: string,
  ): Promise<TypologyDocument> {
    await this.assertNoActiveDuplicateCodigo(orgId, dto.codigo);

    const hasDeclaredData = !!(dto.nombre && dto.codigo && dto.version);

    const doc = new this.model({
      orgId,
      typologyStatus: hasDeclaredData ? TypologyStatus.ACTIVE : TypologyStatus.INCOMPLETE,
      estructuraOrg: {
        departamentoId:    structureNames.departamentoId,
        departamentoNombre: structureNames.departamentoNombre,
        areaId:            structureNames.areaId   ?? null,
        areaNombre:        structureNames.areaNombre ?? null,
        cargoId:           structureNames.cargoId   ?? null,
        cargoNombre:       structureNames.cargoNombre ?? null,
      },
      datosDeclarados: {
        nombre:  dto.nombre  ?? null,
        codigo:  dto.codigo  ?? null,
        version: dto.version ?? null,
        fuente:  source === CreationSource.BULK_IMPORT ? DataSource.EXCEL : DataSource.MANUAL,
      },
      fuenteCreacion: source,
      reviewCycleEnabled: dto.reviewCycleEnabled ?? false,
    });

    try {
      const saved = await doc.save();
      if (actorId) {
        this.emitAuditLog({
          actorId,
          orgId,
          action:       'TYPOLOGY_CREATED',
          resourceId:   (saved._id as Types.ObjectId).toString(),
          resourceName: dto.nombre ?? dto.codigo ?? undefined,
          metadata:     { source },
        });
      }
      return saved;
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException({
          message: `An active typology with code '${dto.codigo}' already exists in this organization. Only one active typology per code is allowed.`,
          errorCode: 'TYPOLOGY_CODE_ALREADY_EXISTS',
          params: { codigo: dto.codigo },
        });
      }
      throw err;
    }
  }

  findAll(orgId: string, page = 1, limit = 20, status?: TypologyStatus): Promise<TypologyDocument[]> {
    const skip = (page - 1) * limit;
    const filter: FilterQuery<TypologyDocument> = status ? { orgId, typologyStatus: status } : { orgId };
    return this.model
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  async findOne(orgId: string, id: string): Promise<TypologyDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({ message: 'Invalid typology ID', errorCode: 'TYPOLOGY_INVALID_ID' });
    }
    const doc = await this.model.findOne({ _id: id, orgId, deletedAt: null }).exec();
    if (!doc) {
      throw new NotFoundException({ message: `Typology ${id} not found`, errorCode: 'TYPOLOGY_NOT_FOUND', params: { id } });
    }
    return doc;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateTypologyDto,
    structureNames?: OrgStructureNames,
    actorId?: string,
  ): Promise<TypologyDocument> {
    const doc = await this.findOne(orgId, id);

    // Version change: new version must be equal to the current one or exactly one increment above
    if (dto.version !== undefined && dto.version !== null) {
      const oldVersion = doc.datosDeclarados.version;
      if (oldVersion && dto.version !== oldVersion && !isExactlyOneIncrement(dto.version, oldVersion)) {
        throw new BadRequestException({
          message: `The new version (${dto.version}) must be equal to or exactly one increment above the current version (${oldVersion}).`,
          errorCode: 'TYPOLOGY_VERSION_INVALID',
          params: { newVersion: dto.version, oldVersion },
        });
      }
    }

    if (dto.nombre  !== undefined) doc.datosDeclarados.nombre  = dto.nombre;
    if (dto.codigo  !== undefined) doc.datosDeclarados.codigo  = dto.codigo;
    if (dto.version !== undefined) doc.datosDeclarados.version = dto.version;
    if (dto.reviewCycleEnabled !== undefined) doc.reviewCycleEnabled = dto.reviewCycleEnabled;

    if (structureNames) {
      doc.estructuraOrg.departamentoId     = structureNames.departamentoId;
      doc.estructuraOrg.departamentoNombre = structureNames.departamentoNombre;
      doc.estructuraOrg.areaId             = structureNames.areaId   ?? null;
      doc.estructuraOrg.areaNombre         = structureNames.areaNombre ?? null;
      doc.estructuraOrg.cargoId            = structureNames.cargoId   ?? null;
      doc.estructuraOrg.cargoNombre        = structureNames.cargoNombre ?? null;
    }

    const hasDeclaredData = !!(doc.datosDeclarados.nombre && doc.datosDeclarados.codigo && doc.datosDeclarados.version);
    doc.typologyStatus = hasDeclaredData ? TypologyStatus.ACTIVE : TypologyStatus.INCOMPLETE;

    if (hasDeclaredData) {
      await this.assertNoActiveDuplicateCodigo(
        orgId,
        doc.datosDeclarados.codigo,
        doc._id as Types.ObjectId,
      );
    }

    try {
      const saved = await doc.save();
      if (actorId) {
        this.emitAuditLog({
          actorId,
          orgId,
          action:       'TYPOLOGY_UPDATED',
          resourceId:   id,
          resourceName: saved.datosDeclarados.nombre ?? saved.datosDeclarados.codigo ?? undefined,
          metadata:     { fields: Object.keys(dto), structureChanged: !!structureNames },
        });
      }
      return saved;
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException({
          message: `An active typology with code '${dto.codigo}' already exists in this organization. Only one active typology per code is allowed.`,
          errorCode: 'TYPOLOGY_CODE_ALREADY_EXISTS',
          params: { codigo: dto.codigo },
        });
      }
      throw err;
    }
  }

  async remove(orgId: string, id: string, actorId?: string): Promise<void> {
    const doc = await this.findOne(orgId, id);
    doc.deletedAt = new Date();
    doc.typologyStatus = TypologyStatus.DELETED;
    await doc.save();
    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'TYPOLOGY_DELETED', resourceId: id, resourceName: doc.datosDeclarados.nombre ?? doc.datosDeclarados.codigo ?? undefined });
    }
  }

  /** Returns all typologies (including soft-deleted) that share the same codigo within the org */
  findHistory(orgId: string, codigo: string): Promise<TypologyDocument[]> {
    return this.model
      .find({ orgId, 'datosDeclarados.codigo': codigo })
      .sort({ createdAt: -1 })
      .limit(50)
      .exec();
  }

  /** Called by Kafka consumer when metadata extraction succeeds */
  async applyExtractedMetadata(
    orgId: string,
    typologyId: string,
    extracted: { nombre: string | null; codigo: string | null; version: string | null },
  ): Promise<void> {
    if (!Types.ObjectId.isValid(typologyId)) return;
    const doc = await this.model.findOne({ _id: typologyId, orgId, deletedAt: null }).exec();
    if (!doc) return; // typology deleted before extraction finished

    const hasDeclared = !!(doc.datosDeclarados.nombre && doc.datosDeclarados.codigo && doc.datosDeclarados.version);

    const nombre  = trimOrNull(extracted.nombre);
    const codigo  = trimOrNull(extracted.codigo);
    const version = trimOrNull(extracted.version);

    doc.metadataExtraida = {
      nombre,
      codigo,
      version,
      extractedAt: new Date(),
      discrepancias: [],
    };

    if (hasDeclared) {
      // Scenario A — compare with declared data
      const discrepancias = [];
      if (nombre  && nombre  !== doc.datosDeclarados.nombre)  discrepancias.push({ campo: 'nombre',  valorDeclarado: doc.datosDeclarados.nombre!,  valorExtraido: nombre });
      if (codigo  && codigo  !== doc.datosDeclarados.codigo)  discrepancias.push({ campo: 'codigo',  valorDeclarado: doc.datosDeclarados.codigo!,  valorExtraido: codigo });
      if (version && version !== doc.datosDeclarados.version) discrepancias.push({ campo: 'version', valorDeclarado: doc.datosDeclarados.version!, valorExtraido: version });

      doc.metadataExtraida.discrepancias = discrepancias;
      doc.documento.extractionStatus = discrepancias.length > 0 ? ExtractionStatus.DISCREPANCY : ExtractionStatus.COMPLETED;
    } else {
      // Scenario B — propose extracted values for user confirmation
      doc.documento.extractionStatus = ExtractionStatus.PENDING_CONFIRMATION;
    }

    await doc.save();
  }

  /** Called by Kafka consumer when metadata extraction fails */
  async markExtractionFailed(orgId: string, typologyId: string, reason: string): Promise<void> {
    if (!Types.ObjectId.isValid(typologyId)) return;
    await this.model.updateOne(
      { _id: typologyId, orgId, deletedAt: null },
      { $set: { 'documento.extractionStatus': ExtractionStatus.FAILED } },
    ).exec();
  }

  /**
   * Counts non-deleted typologies whose estructuraOrg references the given
   * departamento/area/cargo — used by org-service to block deleting a
   * position that a typology still points to. Counts regardless of
   * typologyStatus (INCOMPLETE/ACTIVE/ARCHIVED all count; only soft-deleted
   * ones don't) — deletedAt is this service's source of truth for "does this
   * document still exist", the same convention findOne/findByIdPublic
   * already use; typologyStatus is a lifecycle field, not an existence one.
   */
  countOrgStructureReferences(
    orgId: string,
    filters: { departamentoId?: string; areaId?: string; cargoId?: string },
  ): Promise<number> {
    const filter: FilterQuery<TypologyDocument> = { orgId, deletedAt: null };
    if (filters.departamentoId) filter['estructuraOrg.departamentoId'] = filters.departamentoId;
    if (filters.areaId)         filter['estructuraOrg.areaId']         = filters.areaId;
    if (filters.cargoId)        filter['estructuraOrg.cargoId']        = filters.cargoId;
    return this.model.countDocuments(filter).exec();
  }

  /** Finds a typology by ID scoped to an org — used by internal service calls */
  async findByIdPublic(orgId: string, id: string): Promise<TypologyDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException({ message: 'Invalid typology ID', errorCode: 'TYPOLOGY_INVALID_ID' });
    }
    const doc = await this.model.findOne({ _id: id, orgId, deletedAt: null }).exec();
    if (!doc) {
      throw new NotFoundException({ message: `Typology ${id} not found`, errorCode: 'TYPOLOGY_NOT_FOUND', params: { id } });
    }
    return doc;
  }

  /** Called when user resolves discrepancy or confirms extracted values */
  async resolveDiscrepancy(orgId: string, id: string, dto: ResolveDiscrepancyDto, actorId?: string): Promise<TypologyDocument> {
    const doc = await this.findOne(orgId, id);

    const status = doc.documento.extractionStatus;
    if (status !== ExtractionStatus.DISCREPANCY && status !== ExtractionStatus.PENDING_CONFIRMATION) {
      throw new BadRequestException({
        message: 'No pending discrepancy or confirmation for this typology.',
        errorCode: 'TYPOLOGY_NO_PENDING_ACTION',
      });
    }

    if (dto.action === ResolveAction.KEEP_DECLARED) {
      // No change to datosDeclarados
    } else if (dto.action === ResolveAction.ADOPT_EXTRACTED) {
      // A null extracted field means the extractor simply couldn't find that piece of
      // data in the document — it's not a signal to blank out an already-declared value.
      // Falling back to the existing declared value avoids silently downgrading a
      // complete (ACTIVE) typology to INCOMPLETE — which would make it vanish from the
      // default "active" view — just because e.g. no version string was found.
      doc.datosDeclarados.nombre  = doc.metadataExtraida.nombre  ?? doc.datosDeclarados.nombre;
      doc.datosDeclarados.codigo  = doc.metadataExtraida.codigo  ?? doc.datosDeclarados.codigo;
      doc.datosDeclarados.version = doc.metadataExtraida.version ?? doc.datosDeclarados.version;
      doc.datosDeclarados.fuente  = DataSource.CONFIRMED_FROM_EXTRACTION;
    } else {
      // MANUAL_OVERRIDE
      if (dto.nombre  !== undefined) doc.datosDeclarados.nombre  = dto.nombre;
      if (dto.codigo  !== undefined) doc.datosDeclarados.codigo  = dto.codigo;
      if (dto.version !== undefined) doc.datosDeclarados.version = dto.version;
    }

    // KEEP_DECLARED/MANUAL_OVERRIDE must still match the document's real extracted
    // content. Otherwise the typology is left CONFIRMED with declared data that
    // will never match this same document's extraction the next time it's checked
    // (e.g. when attaching it to a workflow), producing a confusing downstream error.
    if (dto.action !== ResolveAction.ADOPT_EXTRACTED) {
      const extracted = doc.metadataExtraida;
      const declared = doc.datosDeclarados;
      const mismatchedFields: string[] = [];
      if (extracted.nombre  && extracted.nombre  !== declared.nombre)  mismatchedFields.push('nombre');
      if (extracted.codigo  && extracted.codigo  !== declared.codigo)  mismatchedFields.push('codigo');
      if (extracted.version && extracted.version !== declared.version) mismatchedFields.push('version');

      if (mismatchedFields.length > 0) {
        throw new BadRequestException({
          message: "The declared data doesn't match the content of the uploaded document. Adopt the extracted data, or upload a document whose content matches the declared data.",
          errorCode: 'TYPOLOGY_DECLARED_STILL_MISMATCHED',
          params: { fields: mismatchedFields },
        });
      }
    }

    doc.documento.extractionStatus = ExtractionStatus.CONFIRMED;

    const hasDeclaredData = !!(doc.datosDeclarados.nombre && doc.datosDeclarados.codigo && doc.datosDeclarados.version);
    doc.typologyStatus = hasDeclaredData ? TypologyStatus.ACTIVE : TypologyStatus.INCOMPLETE;

    // Explicit pre-check (see assertNoActiveDuplicateCodigo) — without it this
    // path had ONLY the 11000 catch below as protection. That matters
    // specifically here: ADOPT_EXTRACTED is how a user who got blocked at
    // creation for reusing an already-active codigo, then changed the
    // declared codigo just to get past that check while keeping the same
    // document, ends up re-adopting the document's real (colliding) codigo —
    // this is the main way a duplicate-active-codigo actually gets attempted
    // post-creation, so it must not depend solely on the DB index being
    // built (see MGESTDOC-59 / onModuleInit's warning on silent index-sync
    // failures).
    if (hasDeclaredData) {
      await this.assertNoActiveDuplicateCodigo(
        orgId,
        doc.datosDeclarados.codigo,
        doc._id as Types.ObjectId,
      );
    }

    try {
      const saved = await doc.save();
      if (actorId) {
        this.emitAuditLog({
          actorId,
          orgId,
          action:       'TYPOLOGY_DISCREPANCY_RESOLVED',
          resourceId:   id,
          resourceName: saved.datosDeclarados.nombre ?? saved.datosDeclarados.codigo ?? undefined,
          metadata:     { action: dto.action },
        });
      }
      return saved;
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException({
          message: `An active typology with code '${doc.datosDeclarados.codigo}' already exists in this organization. Only one active typology per code is allowed.`,
          errorCode: 'TYPOLOGY_CODE_ALREADY_EXISTS',
          params: { codigo: doc.datosDeclarados.codigo },
        });
      }
      throw err;
    }
  }

  async getStats(orgId: string): Promise<{
    totalTypologies: number;
    activeTypologies: number;
    uploadedDocuments: number;
    storageTotalBytes: number;
    extractionStatusCounts: Record<string, number>;
  }> {
    const [totalTypologies, activeTypologies] = await Promise.all([
      this.model.countDocuments({ orgId }),
      this.model.countDocuments({ orgId, typologyStatus: TypologyStatus.ACTIVE }),
    ]);

    const storageAgg = await this.model.aggregate([
      { $match: { orgId, 'documento.r2Key': { $ne: null } } },
      {
        $group: {
          _id: null,
          uploadedDocuments: { $sum: 1 },
          storageTotalBytes: { $sum: { $ifNull: ['$documento.sizeBytes', 0] } },
        },
      },
    ]);

    const extractionAgg = await this.model.aggregate([
      { $match: { orgId, 'documento.r2Key': { $ne: null } } },
      { $group: { _id: '$documento.extractionStatus', count: { $sum: 1 } } },
    ]);

    const extractionStatusCounts: Record<string, number> = {};
    for (const item of extractionAgg) {
      extractionStatusCounts[item._id as string] = item.count as number;
    }

    return {
      totalTypologies,
      activeTypologies,
      uploadedDocuments: storageAgg[0]?.uploadedDocuments ?? 0,
      storageTotalBytes: storageAgg[0]?.storageTotalBytes ?? 0,
      extractionStatusCounts,
    };
  }

  async getStoragePerOrg(): Promise<{ orgId: string; storageTotalBytes: number; uploadedDocuments: number }[]> {
    const rows = await this.model.aggregate<{
      _id: string;
      storageTotalBytes: number;
      uploadedDocuments: number;
    }>([
      { $match: { 'documento.r2Key': { $ne: null } } },
      {
        $group: {
          _id: '$orgId',
          storageTotalBytes: { $sum: { $ifNull: ['$documento.sizeBytes', 0] } },
          uploadedDocuments: { $sum: 1 },
        },
      },
      { $sort: { storageTotalBytes: -1 } },
    ]);

    return rows.map((r: { _id: string; storageTotalBytes: number; uploadedDocuments: number }) => ({
      orgId: r._id,
      storageTotalBytes: r.storageTotalBytes,
      uploadedDocuments: r.uploadedDocuments,
    }));
  }
}

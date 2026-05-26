import {
  Injectable, NotFoundException, ConflictException, BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Typology, TypologyDocument, TypologyStatus, ExtractionStatus, DataSource, CreationSource,
} from './schemas/typology.schema';
import { CreateTypologyDto } from './dto/create-typology.dto';
import { UpdateTypologyDto } from './dto/update-typology.dto';
import { ResolveDiscrepancyDto, ResolveAction } from './dto/resolve-discrepancy.dto';
import { KafkaProducerService, TOPICS, getClientIp, getCorrelationId } from '@sgd/common';

/**
 * Determines whether `newVer` represents exactly a +1 increment over `oldVer` at the first differing segment, with all subsequent segments in `newVer` equal to zero.
 *
 * @param newVer - New dotted version string (optionally prefixed with `v`, e.g. `v1.2.0`)
 * @param oldVer - Old dotted version string (optionally prefixed with `v`)
 * @returns `true` if the first differing segment in `newVer` equals the corresponding segment in `oldVer` plus one and every following segment in `newVer` is `0`, `false` otherwise.
 */
function isExactlyOneIncrement(newVer: string, oldVer: string): boolean {
  const parse = (v: string) =>
    v.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
  const nv = parse(newVer);
  const ov = parse(oldVer);
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

interface OrgStructureNames {
  departamentoId: string;
  departamentoNombre: string;
  areaId?: string | null;
  areaNombre?: string | null;
  cargoId?: string | null;
  cargoNombre?: string | null;
}

@Injectable()
export class TypologiesService {
  constructor(
    @InjectModel(Typology.name)
    private readonly model: Model<TypologyDocument>,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

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
      metadata:      params.metadata,
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
    // Explicit pre-check: reject if an ACTIVE typology with the same codigo already exists
    if (dto.codigo) {
      const existing = await this.model.findOne({
        orgId,
        'datosDeclarados.codigo': dto.codigo,
        typologyStatus: TypologyStatus.ACTIVE,
      }).exec();
      if (existing) {
        throw new ConflictException(
          `An active typology with code '${dto.codigo}' already exists in this organization. Only one active typology per code is allowed.`,
        );
      }
    }

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
        throw new ConflictException(`An active typology with code '${dto.codigo}' already exists in this organization. Only one active typology per code is allowed.`);
      }
      throw err;
    }
  }

  findAll(orgId: string, page = 1, limit = 20): Promise<TypologyDocument[]> {
    const skip = (page - 1) * limit;
    return this.model
      .find({ orgId, typologyStatus: TypologyStatus.ACTIVE })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  async findOne(orgId: string, id: string): Promise<TypologyDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid typology ID');
    const doc = await this.model.findOne({ _id: id, orgId, deletedAt: null }).exec();
    if (!doc) throw new NotFoundException(`Typology ${id} not found`);
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
        throw new BadRequestException(
          `The new version (${dto.version}) must be equal to or exactly one increment above the current version (${oldVersion}).`,
        );
      }
    }

    if (dto.nombre  !== undefined) doc.datosDeclarados.nombre  = dto.nombre;
    if (dto.codigo  !== undefined) doc.datosDeclarados.codigo  = dto.codigo;
    if (dto.version !== undefined) doc.datosDeclarados.version = dto.version;

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
        throw new ConflictException(`An active typology with code '${dto.codigo}' already exists in this organization. Only one active typology per code is allowed.`);
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

    doc.metadataExtraida = {
      nombre:      extracted.nombre,
      codigo:      extracted.codigo,
      version:     extracted.version,
      extractedAt: new Date(),
      discrepancias: [],
    };

    if (hasDeclared) {
      // Scenario A — compare with declared data
      const discrepancias = [];
      if (extracted.nombre  && extracted.nombre  !== doc.datosDeclarados.nombre)  discrepancias.push({ campo: 'nombre',  valorDeclarado: doc.datosDeclarados.nombre!,  valorExtraido: extracted.nombre });
      if (extracted.codigo  && extracted.codigo  !== doc.datosDeclarados.codigo)  discrepancias.push({ campo: 'codigo',  valorDeclarado: doc.datosDeclarados.codigo!,  valorExtraido: extracted.codigo });
      if (extracted.version && extracted.version !== doc.datosDeclarados.version) discrepancias.push({ campo: 'version', valorDeclarado: doc.datosDeclarados.version!, valorExtraido: extracted.version });

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

  /** Finds a typology by ID scoped to an org — used by internal service calls */
  async findByIdPublic(orgId: string, id: string): Promise<TypologyDocument> {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid typology ID');
    const doc = await this.model.findOne({ _id: id, orgId, deletedAt: null }).exec();
    if (!doc) throw new NotFoundException(`Typology ${id} not found`);
    return doc;
  }

  /** Called when user resolves discrepancy or confirms extracted values */
  async resolveDiscrepancy(orgId: string, id: string, dto: ResolveDiscrepancyDto, actorId?: string): Promise<TypologyDocument> {
    const doc = await this.findOne(orgId, id);

    const status = doc.documento.extractionStatus;
    if (status !== ExtractionStatus.DISCREPANCY && status !== ExtractionStatus.PENDING_CONFIRMATION) {
      throw new BadRequestException(`No pending discrepancy or confirmation for this typology.`);
    }

    if (dto.action === ResolveAction.KEEP_DECLARED) {
      // No change to datosDeclarados
    } else if (dto.action === ResolveAction.ADOPT_EXTRACTED) {
      doc.datosDeclarados.nombre  = doc.metadataExtraida.nombre;
      doc.datosDeclarados.codigo  = doc.metadataExtraida.codigo;
      doc.datosDeclarados.version = doc.metadataExtraida.version;
      doc.datosDeclarados.fuente  = DataSource.CONFIRMED_FROM_EXTRACTION;
    } else {
      // MANUAL_OVERRIDE
      if (dto.nombre  !== undefined) doc.datosDeclarados.nombre  = dto.nombre;
      if (dto.codigo  !== undefined) doc.datosDeclarados.codigo  = dto.codigo;
      if (dto.version !== undefined) doc.datosDeclarados.version = dto.version;
    }

    doc.documento.extractionStatus = ExtractionStatus.CONFIRMED;

    const hasDeclaredData = !!(doc.datosDeclarados.nombre && doc.datosDeclarados.codigo && doc.datosDeclarados.version);
    doc.typologyStatus = hasDeclaredData ? TypologyStatus.ACTIVE : TypologyStatus.INCOMPLETE;

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
        throw new ConflictException(
          `An active typology with code '${doc.datosDeclarados.codigo}' already exists in this organization. Only one active typology per code is allowed.`,
        );
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

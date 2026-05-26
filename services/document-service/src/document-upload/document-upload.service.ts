import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Typology, TypologyDocument, ExtractionStatus, TypologyStatus } from '../typologies/schemas/typology.schema';
import { StorageService } from '../common/storage/storage.service';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';
import { TOPICS } from '../common/kafka/kafka.constants';
import { AppLogger } from '../common/logger/app-logger.service';
import { getClientIp, getCorrelationId } from '../common/correlation/correlation.context';
import { TypologyResponseDto } from '../typologies/dto/typology-response.dto';
import { ALLOWED_MIMETYPES, MAX_FILE_SIZE } from './document-upload.constants';

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
  constructor(
    @InjectModel(Typology.name)
    private readonly model: Model<TypologyDocument>,
    private readonly storage: StorageService,
    private readonly kafka: KafkaProducerService,
    private readonly logger: AppLogger,
  ) {}

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
      resourceType:  'typology',
      resourceId:    params.resourceId,
      resourceName:  params.resourceName ?? null,
      correlationId:         getCorrelationId(),
      businessCorrelationId: params.resourceId,
      ip:            getClientIp(),
      metadata:      params.metadata,
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

    const previousDoc = typology.documento?.r2Key ? { ...typology.documento } : null;
    const r2Key = `org/${orgId}/typologies/${typologyId}/${uuidv4()}.${ext}`;

    // Step 1: Upload new file — if this fails, nothing in DB has changed yet.
    await this.storage.upload(r2Key, file.buffer, file.mimetype);

    // Step 2: Persist new state — if this fails, delete the orphaned upload.
    typology.documento = {
      r2Key,
      originalName:      file.originalname,
      mimeType:          file.mimetype,
      uploadedAt:        new Date(),
      extractionStatus:  ExtractionStatus.PROCESSING,
      sizeBytes:         file.size ?? null,
    };

    try {
      await typology.save();
    } catch (err) {
      await this.storage.delete(r2Key).catch(() => {});
      throw err;
    }

    // Step 3: Emit extraction event — if Kafka fails, revert DB to previous state.
    try {
      await this.kafka.emit(TOPICS.TYPOLOGY_FILE_UPLOADED, {
        orgId,
        typologyId,
        r2Key,
        mimeType: file.mimetype,
        ...(orgName ? { orgName } : {}),
      });
    } catch (err) {
      typology.documento = previousDoc ?? {
        r2Key: null, originalName: null, mimeType: null, uploadedAt: null,
        extractionStatus: ExtractionStatus.NOT_UPLOADED, sizeBytes: null,
      };
      const rollbackPersisted = await typology.save().then(() => true).catch(() => false);
      if (rollbackPersisted) {
        await this.storage.delete(r2Key).catch(() => {});
      } else {
        this.logger.error(
          `Rollback failed for typology ${typologyId}; keeping uploaded object ${r2Key} to avoid a dangling reference.`,
          undefined,
          'DocumentUploadService',
        );
      }
      throw new InternalServerErrorException('Failed to trigger metadata extraction. Upload rolled back.');
    }

    // Step 4: Delete the previous file only after everything succeeded (fire-and-forget).
    if (previousDoc?.r2Key) {
      await this.storage.delete(previousDoc.r2Key).catch(() => {});
    }

    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'TYPOLOGY_DOCUMENT_UPLOADED', resourceId: typologyId, resourceName: typology.datosDeclarados.nombre ?? typology.datosDeclarados.codigo ?? undefined, metadata: { mimeType: file.mimetype, originalName: file.originalname } });
    }

    this.logger.log(`Document uploaded for typology ${typologyId}, extraction started`, 'DocumentUploadService');

    return { message: 'Document uploaded. Metadata extraction in progress.', extractionStatus: ExtractionStatus.PROCESSING };
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

    const ext = ALLOWED_MIMETYPES[file.mimetype];
    if (!ext) throw new BadRequestException('Format not allowed. Use PDF, DOCX or XLSX.');
    if (file.size > MAX_FILE_SIZE) throw new BadRequestException('File exceeds the maximum allowed size of 20 MB.');

    const newVersion = dto.version ?? null;
    const oldVersion = old.datosDeclarados.version;

    if (newVersion && oldVersion && !isExactlyOneIncrement(newVersion, oldVersion)) {
      throw new BadRequestException(
        `The new version (${newVersion}) must be exactly one increment above the current version (${oldVersion}).`,
      );
    }

    // Step 1: Create new typology — old remains ACTIVE until everything succeeds.
    const nombre  = dto.nombre  !== undefined ? dto.nombre  : old.datosDeclarados.nombre;
    const version = newVersion  !== null       ? newVersion  : old.datosDeclarados.version;
    const codigo  = old.datosDeclarados.codigo;
    const hasDeclaredData = !!(nombre && codigo && version);

    const newDoc = new this.model({
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

    await newDoc.save();

    const newTypologyId = (newDoc._id as Types.ObjectId).toString();
    const r2Key = `org/${orgId}/typologies/${newTypologyId}/${uuidv4()}.${ext}`;

    // Step 2: Upload file — if this fails, delete newDoc, old stays ACTIVE.
    try {
      await this.storage.upload(r2Key, file.buffer, file.mimetype);
    } catch (err) {
      await newDoc.deleteOne().catch(() => {});
      throw err;
    }

    // Step 3: Persist documento on new doc — if this fails, clean up file + newDoc.
    newDoc.documento = {
      r2Key,
      originalName:     file.originalname,
      mimeType:         file.mimetype,
      uploadedAt:       new Date(),
      extractionStatus: ExtractionStatus.PROCESSING,
      sizeBytes:        file.size ?? null,
    };

    try {
      await newDoc.save();
    } catch (err) {
      await this.storage.delete(r2Key).catch(() => {});
      await newDoc.deleteOne().catch(() => {});
      throw err;
    }

    // Step 4: Archive old — only now that new doc is fully persisted.
    // If this fails, clean up new doc + file (old is still ACTIVE).
    old.typologyStatus = TypologyStatus.ARCHIVED;
    try {
      await old.save();
    } catch (err) {
      await this.storage.delete(r2Key).catch(() => {});
      await newDoc.deleteOne().catch(() => {});
      throw err;
    }

    // Step 5: Emit extraction event — if Kafka fails, restore old to ACTIVE and clean up.
    try {
      await this.kafka.emit(TOPICS.TYPOLOGY_FILE_UPLOADED, {
        orgId,
        typologyId: newTypologyId,
        r2Key,
        mimeType: file.mimetype,
        ...(dto.orgName ? { orgName: dto.orgName } : {}),
      });
    } catch (err) {
      old.typologyStatus = TypologyStatus.ACTIVE;
      await old.save().catch(() => {});
      await this.storage.delete(r2Key).catch(() => {});
      await newDoc.deleteOne().catch(() => {});
      throw new InternalServerErrorException('Failed to trigger metadata extraction. New version rolled back.');
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

    const typology = await this.model.findOne({ _id: typologyId, orgId, deletedAt: null }).exec();
    if (!typology) throw new NotFoundException(`Typology ${typologyId} not found`);
    if (!typology.documento?.r2Key) throw new BadRequestException('Esta tipología no tiene documento cargado');

    if (typology.documento.extractionStatus !== ExtractionStatus.FAILED) {
      throw new BadRequestException(
        `Solo se puede reintentar cuando la extracción ha fallado. Estado actual: ${typology.documento.extractionStatus}`,
      );
    }

    typology.documento.extractionStatus = ExtractionStatus.PROCESSING;
    await typology.save();

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
      await typology.save().catch(() => {});
      throw new InternalServerErrorException('No se pudo reencolar la extracción. Intenta de nuevo.');
    }

    if (actorId) {
      this.emitAuditLog({ actorId, orgId, action: 'TYPOLOGY_EXTRACTION_RETRIED', resourceId: typologyId, resourceName: typology.datosDeclarados.nombre ?? typology.datosDeclarados.codigo ?? undefined });
    }

    this.logger.log(`Extraction retried for typology ${typologyId}`, 'DocumentUploadService');
    return { message: 'Extracción reencolada.', extractionStatus: ExtractionStatus.PROCESSING };
  }
}

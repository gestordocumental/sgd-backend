import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Typology, TypologyDocument, ExtractionStatus, TypologyStatus } from '../typologies/schemas/typology.schema';
import { StorageService } from '../common/storage/storage.service';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';
import { TOPICS } from '../common/kafka/kafka.constants';
import { AppLogger } from '../common/logger/app-logger.service';
import { TypologyResponseDto } from '../typologies/dto/typology-response.dto';
import { ALLOWED_MIMETYPES, MAX_FILE_SIZE } from './document-upload.constants';

/**
 * Returns true only if newVer is exactly one increment above oldVer.
 * Rules:
 *  - The first segment that changes must increase by exactly 1.
 *  - All segments to the right of that change must be 0 (reset on bump).
 *  - Incrementing a higher segment while keeping lower ones unchanged is invalid.
 *
 * Examples: "05"→"06" ✓  "05"→"07" ✗  "v1.0"→"v1.1" ✓  "v1.9"→"v2.0" ✓  "v1.0"→"v2.1" ✗
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

  async upload(
    orgId: string,
    typologyId: string,
    file: Express.Multer.File,
    orgName?: string,
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
        extractionStatus: ExtractionStatus.NOT_UPLOADED,
      };
      await typology.save().catch(() => {});
      await this.storage.delete(r2Key).catch(() => {});
      throw new InternalServerErrorException('Failed to trigger metadata extraction. Upload rolled back.');
    }

    // Step 4: Delete the previous file only after everything succeeded (fire-and-forget).
    if (previousDoc?.r2Key) {
      await this.storage.delete(previousDoc.r2Key).catch(() => {});
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
    dto: { nombre?: string; version?: string; orgName?: string },
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

    // 1. Archive the previous typology
    old.typologyStatus = TypologyStatus.ARCHIVED;
    await old.save();

    // 2. Create the new typology inheriting org structure and codigo
    const nombre  = dto.nombre  !== undefined ? dto.nombre  : old.datosDeclarados.nombre;
    const version = newVersion  !== null       ? newVersion  : old.datosDeclarados.version;
    const codigo  = old.datosDeclarados.codigo;
    const hasDeclaredData = !!(nombre && codigo && version);

    const newDoc = new this.model({
      orgId,
      typologyStatus:  hasDeclaredData ? TypologyStatus.ACTIVE : TypologyStatus.INCOMPLETE,
      fuenteCreacion:  old.fuenteCreacion,
      estructuraOrg: {
        departamentoId:    old.estructuraOrg.departamentoId,
        departamentoNombre: old.estructuraOrg.departamentoNombre,
        areaId:            old.estructuraOrg.areaId,
        areaNombre:        old.estructuraOrg.areaNombre,
        cargoId:           old.estructuraOrg.cargoId,
        cargoNombre:       old.estructuraOrg.cargoNombre,
      },
      datosDeclarados: {
        nombre,
        codigo,
        version,
        fuente: old.datosDeclarados.fuente,
      },
    });

    await newDoc.save();

    // 3. Upload file under the new typology's ID
    const newTypologyId = (newDoc._id as Types.ObjectId).toString();
    const r2Key = `org/${orgId}/typologies/${newTypologyId}/${uuidv4()}.${ext}`;
    await this.storage.upload(r2Key, file.buffer, file.mimetype);

    newDoc.documento = {
      r2Key,
      originalName:     file.originalname,
      mimeType:         file.mimetype,
      uploadedAt:       new Date(),
      extractionStatus: ExtractionStatus.PROCESSING,
    };

    await newDoc.save();

    // 4. Trigger async metadata extraction
    await this.kafka.emit(TOPICS.TYPOLOGY_FILE_UPLOADED, {
      orgId,
      typologyId: newTypologyId,
      r2Key,
      mimeType: file.mimetype,
      ...(dto.orgName ? { orgName: dto.orgName } : {}),
    });

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

    const { url, expiresAt } = await this.storage.getSignedDownloadUrl(typology.documento.r2Key);
    return { signedUrl: url, expiresAt };
  }
}

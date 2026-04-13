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
  ) {}

  async create(
    orgId: string,
    dto: CreateTypologyDto,
    structureNames: OrgStructureNames,
    source: CreationSource = CreationSource.MANUAL,
  ): Promise<TypologyDocument> {
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
      return await doc.save();
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException(`Ya existe una tipología con el código '${dto.codigo}' en esta organización`);
      }
      throw err;
    }
  }

  findAll(orgId: string, page = 1, limit = 20): Promise<TypologyDocument[]> {
    const skip = (page - 1) * limit;
    return this.model
      .find({ orgId, deletedAt: null })
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

  async update(orgId: string, id: string, dto: UpdateTypologyDto): Promise<TypologyDocument> {
    const doc = await this.findOne(orgId, id);

    if (dto.nombre  !== undefined) doc.datosDeclarados.nombre  = dto.nombre;
    if (dto.codigo  !== undefined) doc.datosDeclarados.codigo  = dto.codigo;
    if (dto.version !== undefined) doc.datosDeclarados.version = dto.version;

    if (dto.departamentoId !== undefined) doc.estructuraOrg.departamentoId = dto.departamentoId;
    if (dto.areaId         !== undefined) doc.estructuraOrg.areaId         = dto.areaId ?? null;
    if (dto.cargoId        !== undefined) doc.estructuraOrg.cargoId        = dto.cargoId ?? null;

    const hasDeclaredData = !!(doc.datosDeclarados.nombre && doc.datosDeclarados.codigo && doc.datosDeclarados.version);
    doc.typologyStatus = hasDeclaredData ? TypologyStatus.ACTIVE : TypologyStatus.INCOMPLETE;

    try {
      return await doc.save();
    } catch (err: any) {
      if (err.code === 11000) {
        throw new ConflictException(`Ya existe una tipología con el código '${dto.codigo}' en esta organización`);
      }
      throw err;
    }
  }

  async remove(orgId: string, id: string): Promise<void> {
    const doc = await this.findOne(orgId, id);
    doc.deletedAt = new Date();
    await doc.save();
  }

  /** Called by Kafka consumer when metadata extraction succeeds */
  async applyExtractedMetadata(
    orgId: string,
    typologyId: string,
    extracted: { nombre: string | null; codigo: string | null; version: string | null },
  ): Promise<void> {
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

  /** Called when user resolves discrepancy or confirms extracted values */
  async resolveDiscrepancy(orgId: string, id: string, dto: ResolveDiscrepancyDto): Promise<TypologyDocument> {
    const doc = await this.findOne(orgId, id);

    const status = doc.documento.extractionStatus;
    if (status !== ExtractionStatus.DISCREPANCY && status !== ExtractionStatus.PENDING_CONFIRMATION) {
      throw new BadRequestException(`No hay discrepancia o confirmación pendiente en esta tipología`);
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

    return doc.save();
  }
}

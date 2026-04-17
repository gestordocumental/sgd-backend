import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type TypologyDocument = HydratedDocument<Typology>;

export enum TypologyStatus {
  INCOMPLETE = 'INCOMPLETE',
  ACTIVE     = 'ACTIVE',
  ARCHIVED   = 'ARCHIVED',
  DELETED    = 'DELETED',
}

export enum ExtractionStatus {
  NOT_UPLOADED          = 'NOT_UPLOADED',
  PROCESSING            = 'PROCESSING',
  COMPLETED             = 'COMPLETED',
  DISCREPANCY           = 'DISCREPANCY',
  PENDING_CONFIRMATION  = 'PENDING_CONFIRMATION',
  CONFIRMED             = 'CONFIRMED',
  FAILED                = 'FAILED',
}

export enum DataSource {
  EXCEL                      = 'EXCEL',
  MANUAL                     = 'MANUAL',
  CONFIRMED_FROM_EXTRACTION  = 'CONFIRMED_FROM_EXTRACTION',
}

export enum CreationSource {
  MANUAL      = 'MANUAL',
  BULK_IMPORT = 'BULK_IMPORT',
}

@Schema({ _id: false })
class OrgStructure {
  @Prop({ required: true })
  departamentoId!: string;

  @Prop({ required: true })
  departamentoNombre!: string;

  @Prop({ type: String, default: null })
  areaId!: string | null;

  @Prop({ type: String, default: null })
  areaNombre!: string | null;

  @Prop({ type: String, default: null })
  cargoId!: string | null;

  @Prop({ type: String, default: null })
  cargoNombre!: string | null;
}

@Schema({ _id: false })
class DatosDeclarados {
  @Prop({ type: String, default: null })
  nombre!: string | null;

  @Prop({ type: String, default: null })
  codigo!: string | null;

  @Prop({ type: String, default: null })
  version!: string | null;

  @Prop({ type: String, enum: DataSource, default: DataSource.MANUAL })
  fuente!: DataSource;
}

@Schema({ _id: false })
class DocumentoInfo {
  @Prop({ type: String, default: null })
  r2Key!: string | null;

  @Prop({ type: String, default: null })
  originalName!: string | null;

  @Prop({ type: String, default: null })
  mimeType!: string | null;

  @Prop({ type: Date, default: null })
  uploadedAt!: Date | null;

  @Prop({ type: String, enum: ExtractionStatus, default: ExtractionStatus.NOT_UPLOADED })
  extractionStatus!: ExtractionStatus;
}

@Schema({ _id: false })
class Discrepancia {
  @Prop()
  campo!: string;

  @Prop()
  valorDeclarado!: string;

  @Prop()
  valorExtraido!: string;
}

@Schema({ _id: false })
class MetadataExtraida {
  @Prop({ type: String, default: null })
  nombre!: string | null;

  @Prop({ type: String, default: null })
  codigo!: string | null;

  @Prop({ type: String, default: null })
  version!: string | null;

  @Prop({ type: Date, default: null })
  extractedAt!: Date | null;

  @Prop({ type: [{ campo: String, valorDeclarado: String, valorExtraido: String }], default: [] })
  discrepancias!: Discrepancia[];
}

@Schema({ timestamps: true, collection: 'typologies' })
export class Typology {
  /** Cross-service reference — no FK */
  @Prop({ required: true, index: true })
  orgId!: string;

  @Prop({ type: String, enum: TypologyStatus, default: TypologyStatus.INCOMPLETE, index: true })
  typologyStatus!: TypologyStatus;

  @Prop({ type: OrgStructure, required: true })
  estructuraOrg!: OrgStructure;

  @Prop({ type: DatosDeclarados, default: () => ({}) })
  datosDeclarados!: DatosDeclarados;

  @Prop({ type: DocumentoInfo, default: () => ({}) })
  documento!: DocumentoInfo;

  @Prop({ type: MetadataExtraida, default: () => ({}) })
  metadataExtraida!: MetadataExtraida;

  @Prop({ type: String, enum: CreationSource, default: CreationSource.MANUAL })
  fuenteCreacion!: CreationSource;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;
}

export const TypologySchema = SchemaFactory.createForClass(Typology);

// Partial unique index: only one ACTIVE typology per (orgId, codigo) is allowed.
// INCOMPLETE / ARCHIVED / soft-deleted records with the same codigo are permitted.
TypologySchema.index(
  { orgId: 1, 'datosDeclarados.codigo': 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
      typologyStatus: TypologyStatus.ACTIVE,
      'datosDeclarados.codigo': { $ne: null },
    },
  },
);

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

  @Prop({ type: Number, default: null })
  sizeBytes!: number | null;

  /**
   * When the *current* extraction attempt started — distinct from
   * `uploadedAt`, which never changes across retries. DocumentUploadService
   * sets this every time extractionStatus flips to PROCESSING (initial
   * upload, new version, or retryExtraction()), atomically with that same
   * save, before emitting the Kafka event. Used to detect an extraction
   * genuinely stuck in PROCESSING (see STUCK_EXTRACTION_THRESHOLD_MS) —
   * using `uploadedAt` for that instead would never reset on a successful
   * retry, so a second retry call moments after a legitimate one started
   * would also see the file as "old" and be allowed to re-interrupt it.
   */
  @Prop({ type: Date, default: null })
  extractionStartedAt!: Date | null;
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

  /**
   * Feature flag: whether workflows created against this typology go through
   * the admin review cycle step. Replaces the old org-wide flag — each
   * typology now controls this independently. Defaults to false (opt-in) for
   * typologies created from now on. Typologies that predate this field were
   * backfilled to true by scripts/backfill-review-cycle-enabled.ts, matching
   * the old org-wide default they used to inherit — see that script for why.
   */
  @Prop({ type: Boolean, default: false })
  reviewCycleEnabled!: boolean;

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

// Covers findAll: find({ orgId, typologyStatus }).sort({ createdAt: -1 }) — avoids in-memory sort.
TypologySchema.index({ orgId: 1, typologyStatus: 1, createdAt: -1 });

// Covers findHistory: find({ orgId, 'datosDeclarados.codigo' }).sort({ createdAt: -1 }).
// The partial unique index above is restricted to ACTIVE docs and cannot serve this query
// (history includes DELETED/ARCHIVED). This non-partial index fills that gap.
TypologySchema.index({ orgId: 1, 'datosDeclarados.codigo': 1, createdAt: -1 });

// Covers countOrgStructureReferences: countDocuments({ orgId, deletedAt: null,
// 'estructuraOrg.<field>': id }) — used by org-service to block deleting a
// departamento/area/cargo that a typology still references. departamentoId is
// always set (required on every typology), so no partial filter needed there;
// areaId/cargoId are only ever queried with a real id (never null — an
// "unset" typology is never what's being deleted), so the partial filter
// keeps the index small by excluding the common null case.
TypologySchema.index({ orgId: 1, 'estructuraOrg.departamentoId': 1, deletedAt: 1 });
TypologySchema.index(
  { orgId: 1, 'estructuraOrg.areaId': 1, deletedAt: 1 },
  { partialFilterExpression: { 'estructuraOrg.areaId': { $ne: null } } },
);
TypologySchema.index(
  { orgId: 1, 'estructuraOrg.cargoId': 1, deletedAt: 1 },
  { partialFilterExpression: { 'estructuraOrg.cargoId': { $ne: null } } },
);

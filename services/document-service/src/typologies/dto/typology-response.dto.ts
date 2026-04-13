import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CreationSource,
  DataSource,
  ExtractionStatus,
  TypologyDocument,
  TypologyStatus,
} from '../schemas/typology.schema';

class TypologyOrgStructureResponseDto {
  @ApiProperty({ format: 'uuid' })
  departamentoId!: string;

  @ApiProperty()
  departamentoNombre!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  areaId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  areaNombre!: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  cargoId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  cargoNombre!: string | null;
}

class TypologyDeclaredDataResponseDto {
  @ApiPropertyOptional({ nullable: true })
  nombre!: string | null;

  @ApiPropertyOptional({ nullable: true })
  codigo!: string | null;

  @ApiPropertyOptional({ nullable: true })
  version!: string | null;

  @ApiProperty({ enum: DataSource })
  fuente!: DataSource;
}

class TypologyDocumentInfoResponseDto {
  @ApiPropertyOptional({ nullable: true })
  r2Key!: string | null;

  @ApiPropertyOptional({ nullable: true })
  originalName!: string | null;

  @ApiPropertyOptional({ nullable: true })
  mimeType!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  uploadedAt!: Date | null;

  @ApiProperty({ enum: ExtractionStatus })
  extractionStatus!: ExtractionStatus;
}

class TypologyDiscrepancyResponseDto {
  @ApiProperty()
  campo!: string;

  @ApiProperty()
  valorDeclarado!: string;

  @ApiProperty()
  valorExtraido!: string;
}

class TypologyExtractedMetadataResponseDto {
  @ApiPropertyOptional({ nullable: true })
  nombre!: string | null;

  @ApiPropertyOptional({ nullable: true })
  codigo!: string | null;

  @ApiPropertyOptional({ nullable: true })
  version!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  extractedAt!: Date | null;

  @ApiProperty({ type: [TypologyDiscrepancyResponseDto] })
  discrepancias!: TypologyDiscrepancyResponseDto[];
}

export class TypologyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orgId!: string;

  @ApiProperty({ enum: TypologyStatus })
  typologyStatus!: TypologyStatus;

  @ApiProperty({ type: TypologyOrgStructureResponseDto })
  estructuraOrg!: TypologyOrgStructureResponseDto;

  @ApiProperty({ type: TypologyDeclaredDataResponseDto })
  datosDeclarados!: TypologyDeclaredDataResponseDto;

  @ApiProperty({ type: TypologyDocumentInfoResponseDto })
  documento!: TypologyDocumentInfoResponseDto;

  @ApiProperty({ type: TypologyExtractedMetadataResponseDto })
  metadataExtraida!: TypologyExtractedMetadataResponseDto;

  @ApiProperty({ enum: CreationSource })
  fuenteCreacion!: CreationSource;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  deletedAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;

  static fromDocument(doc: TypologyDocument): TypologyResponseDto {
    const dto = new TypologyResponseDto();
    dto.id = doc.id;
    dto.orgId = doc.orgId;
    dto.typologyStatus = doc.typologyStatus;
    dto.estructuraOrg = {
      departamentoId: doc.estructuraOrg.departamentoId,
      departamentoNombre: doc.estructuraOrg.departamentoNombre,
      areaId: doc.estructuraOrg.areaId ?? null,
      areaNombre: doc.estructuraOrg.areaNombre ?? null,
      cargoId: doc.estructuraOrg.cargoId ?? null,
      cargoNombre: doc.estructuraOrg.cargoNombre ?? null,
    };
    dto.datosDeclarados = {
      nombre: doc.datosDeclarados.nombre ?? null,
      codigo: doc.datosDeclarados.codigo ?? null,
      version: doc.datosDeclarados.version ?? null,
      fuente: doc.datosDeclarados.fuente,
    };
    dto.documento = {
      r2Key: doc.documento?.r2Key ?? null,
      originalName: doc.documento?.originalName ?? null,
      mimeType: doc.documento?.mimeType ?? null,
      uploadedAt: doc.documento?.uploadedAt ?? null,
      extractionStatus: doc.documento?.extractionStatus ?? ExtractionStatus.NOT_UPLOADED,
    };
    dto.metadataExtraida = {
      nombre: doc.metadataExtraida?.nombre ?? null,
      codigo: doc.metadataExtraida?.codigo ?? null,
      version: doc.metadataExtraida?.version ?? null,
      extractedAt: doc.metadataExtraida?.extractedAt ?? null,
      discrepancias: (doc.metadataExtraida?.discrepancias ?? []).map((item) => ({
        campo: item.campo,
        valorDeclarado: item.valorDeclarado,
        valorExtraido: item.valorExtraido,
      })),
    };
    dto.fuenteCreacion = doc.fuenteCreacion;
    dto.deletedAt = doc.deletedAt ?? null;
    dto.createdAt = (doc as any).createdAt;
    dto.updatedAt = (doc as any).updatedAt;
    return dto;
  }
}

import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { Typology, TypologyDocument, ExtractionStatus } from '../typologies/schemas/typology.schema';
import { StorageService } from '../common/storage/storage.service';
import { KafkaProducerService } from '../common/kafka/kafka-producer.service';
import { TOPICS } from '../common/kafka/kafka.constants';
import { AppLogger } from '../common/logger/app-logger.service';

const ALLOWED_MIMETYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

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
    if (!ext) throw new BadRequestException(`Formato no permitido. Use PDF, DOCX o DOC`);

    if (file.size > MAX_FILE_SIZE) throw new BadRequestException('El archivo supera el tamaño máximo de 20MB');

    // Delete previous file if exists
    if (typology.documento?.r2Key) {
      await this.storage.delete(typology.documento.r2Key).catch(() => {});
    }

    const r2Key = `org/${orgId}/typologies/${typologyId}/${uuidv4()}.${ext}`;

    await this.storage.upload(r2Key, file.buffer, file.mimetype);

    typology.documento = {
      r2Key,
      originalName:      file.originalname,
      mimeType:          file.mimetype,
      uploadedAt:        new Date(),
      extractionStatus:  ExtractionStatus.PROCESSING,
    };

    await typology.save();

    // Emit async extraction event — metadata-extractor-service will consume this
    await this.kafka.emit(TOPICS.TYPOLOGY_FILE_UPLOADED, {
      orgId,
      typologyId,
      r2Key,
      mimeType: file.mimetype,
      ...(orgName ? { orgName } : {}),
    });

    this.logger.log(`Document uploaded for typology ${typologyId}, extraction started`, 'DocumentUploadService');

    return { message: 'Documento cargado. Extracción de metadata en proceso.', extractionStatus: ExtractionStatus.PROCESSING };
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

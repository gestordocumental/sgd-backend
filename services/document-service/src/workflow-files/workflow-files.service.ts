import { BadRequestException, Injectable } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { StorageService } from '../common/storage/storage.service';
import { MAX_FILE_SIZE } from '../document-upload/document-upload.constants';
import { WorkflowFileUploadResponseDto } from './dto/workflow-file-upload-response.dto';

const WORKFLOW_ALLOWED_MIMETYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'image/png':  'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif':  'gif',
  'image/bmp':  'bmp',
  'image/tiff': 'tiff',
};

@Injectable()
export class WorkflowFilesService {
  constructor(private readonly storage: StorageService) {}

  async upload(
    orgId: string,
    file: Express.Multer.File,
  ): Promise<WorkflowFileUploadResponseDto> {
    if (!file) throw new BadRequestException('El archivo es requerido');
    if (file.size > MAX_FILE_SIZE) {
      throw new BadRequestException('El archivo excede el tamaño máximo de 20 MB');
    }

    const ext = WORKFLOW_ALLOWED_MIMETYPES[file.mimetype];
    if (!ext) throw new BadRequestException('Formato no permitido. Use PDF, DOCX, XLSX o imagen (PNG, JPG, WEBP, GIF, BMP, TIFF).');

    const storageKey = `org/${orgId}/workflow-uploads/${uuidv4()}.${ext}`;
    await this.storage.upload(storageKey, file.buffer, file.mimetype);

    return {
      storageKey,
      originalName: file.originalname,
      mimeType:     file.mimetype,
      fileSizeBytes: file.size,
    };
  }

  async getSignedUrl(
    storageKey: string,
  ): Promise<{ signedUrl: string; expiresAt: Date }> {
    const { url, expiresAt } = await this.storage.getSignedDownloadUrl(storageKey);
    return { signedUrl: url, expiresAt };
  }
}

import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PassThrough } from 'stream';
import archiver = require('archiver');
import { v4 as uuidv4 } from 'uuid';
import { StorageService } from '../common/storage/storage.service';
import { MAX_FILE_SIZE } from '../document-upload/document-upload.constants';
import { WorkflowFileUploadResponseDto } from './dto/workflow-file-upload-response.dto';
import type { ZipFileEntryDto } from './dto/download-zip.dto';

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
    orgId: string,
    storageKey: string,
  ): Promise<{ signedUrl: string; expiresAt: Date }> {
    const expectedPrefix = `org/${orgId}/workflow-uploads/`;
    if (!storageKey.startsWith(expectedPrefix)) {
      throw new ForbiddenException('El storageKey no pertenece a la organización solicitante');
    }
    const { url, expiresAt } = await this.storage.getSignedDownloadUrl(storageKey);
    return { signedUrl: url, expiresAt };
  }

  async downloadZip(
    orgId: string,
    entries: ZipFileEntryDto[],
    title: string,
  ): Promise<{ stream: PassThrough; filename: string }> {
    if (entries.length === 0) throw new BadRequestException('No hay archivos para descargar');

    const expectedPrefix = `org/${orgId}/workflow-uploads/`;
    for (const { storageKey } of entries) {
      if (!storageKey.startsWith(expectedPrefix)) {
        throw new ForbiddenException('storageKey no pertenece a la organización');
      }
    }

    // Download all files from R2 concurrently
    const buffers = await Promise.all(
      entries.map(({ storageKey }) => this.storage.downloadBuffer(storageKey)),
    );

    const safeTitle = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
    const filename = `${safeTitle}.zip`;

    const archive = archiver('zip', { zlib: { level: 5 } });
    const pass = new PassThrough();
    archive.pipe(pass);
    archive.on('error', (err) => pass.destroy(err));

    for (let i = 0; i < entries.length; i++) {
      // Prevent path traversal: strip leading slashes and ".." segments
      const safePath = entries[i].zipPath.replace(/\.\./g, '').replace(/^\/+/, '');
      archive.append(buffers[i], { name: `${safeTitle}/${safePath}` });
    }

    void archive.finalize();
    return { stream: pass, filename };
  }
}

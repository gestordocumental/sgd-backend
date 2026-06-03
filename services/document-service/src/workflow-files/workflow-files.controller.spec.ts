import { BadRequestException, StreamableFile } from '@nestjs/common';
import { PassThrough } from 'stream';
import { WorkflowFilesController } from './workflow-files.controller';
import { WorkflowFileUploadResponseDto } from './dto/workflow-file-upload-response.dto';

// ── Helpers ─────────────────────────────────────────────────────────────────

const PDF_MIME = 'application/pdf';

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname:    'file',
    originalname: 'attachment.pdf',
    encoding:     '7bit',
    mimetype:     PDF_MIME,
    size:         2048,
    buffer:       Buffer.from('pdf content'),
    destination:  '',
    filename:     '',
    path:         '',
    stream:       null as any,
    ...overrides,
  };
}

function makeUploadResponse(): WorkflowFileUploadResponseDto {
  return {
    storageKey:    'org/org-1/workflow-uploads/uuid.pdf',
    originalName:  'attachment.pdf',
    mimeType:      PDF_MIME,
    fileSizeBytes: 2048,
  };
}

function makeService() {
  return {
    upload:       jest.fn().mockResolvedValue(makeUploadResponse()),
    getSignedUrl: jest.fn().mockResolvedValue({ signedUrl: 'https://signed.url', expiresAt: new Date() }),
    downloadZip:  jest.fn().mockResolvedValue({ stream: new PassThrough(), filename: 'report.zip' }),
  };
}

// ── WorkflowFilesController ──────────────────────────────────────────────────

describe('WorkflowFilesController', () => {

  describe('upload()', () => {
    it('delegates to service.upload and returns the DTO', async () => {
      const service = makeService();
      const ctrl    = new WorkflowFilesController(service as any);
      const file    = makeFile();

      const result = await ctrl.upload('org-1', file);

      expect(service.upload).toHaveBeenCalledWith('org-1', file);
      expect(result).toMatchObject({
        storageKey:   expect.stringContaining('org/org-1/workflow-uploads/'),
        originalName: 'attachment.pdf',
        mimeType:     PDF_MIME,
      });
    });

    it('throws BadRequestException when no file is provided', async () => {
      const service = makeService();
      const ctrl    = new WorkflowFilesController(service as any);

      await expect(ctrl.upload('org-1', undefined as any)).rejects.toThrow(BadRequestException);
      expect(service.upload).not.toHaveBeenCalled();
    });

    it('propagates errors from service.upload', async () => {
      const service = makeService();
      service.upload.mockRejectedValue(new BadRequestException('Formato no permitido'));
      const ctrl = new WorkflowFilesController(service as any);

      await expect(ctrl.upload('org-1', makeFile())).rejects.toThrow('Formato no permitido');
    });

    it('passes the correct orgId to service.upload', async () => {
      const service = makeService();
      const ctrl    = new WorkflowFilesController(service as any);

      await ctrl.upload('my-org-id', makeFile());

      expect(service.upload).toHaveBeenCalledWith('my-org-id', expect.any(Object));
    });
  });

  describe('getSignedUrl()', () => {
    it('delegates to service.getSignedUrl with orgId and storageKey', async () => {
      const service    = makeService();
      const ctrl       = new WorkflowFilesController(service as any);
      const storageKey = 'org/org-1/workflow-uploads/uuid.pdf';

      const result = await ctrl.getSignedUrl('org-1', storageKey);

      expect(service.getSignedUrl).toHaveBeenCalledWith('org-1', storageKey, undefined, undefined);
      expect(result).toMatchObject({ signedUrl: 'https://signed.url' });
    });

    it('throws BadRequestException when storageKey is empty / not provided', async () => {
      const service = makeService();
      const ctrl    = new WorkflowFilesController(service as any);

      await expect(ctrl.getSignedUrl('org-1', '')).rejects.toThrow(BadRequestException);
      expect(service.getSignedUrl).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when storageKey is undefined', async () => {
      const service = makeService();
      const ctrl    = new WorkflowFilesController(service as any);

      await expect(ctrl.getSignedUrl('org-1', undefined as any)).rejects.toThrow(BadRequestException);
      expect(service.getSignedUrl).not.toHaveBeenCalled();
    });

    it('propagates errors from service.getSignedUrl', async () => {
      const service = makeService();
      service.getSignedUrl.mockRejectedValue(new Error('Forbidden'));
      const ctrl = new WorkflowFilesController(service as any);

      await expect(
        ctrl.getSignedUrl('org-1', 'org/org-1/workflow-uploads/uuid.pdf'),
      ).rejects.toThrow('Forbidden');
    });
  });

  describe('downloadZip()', () => {
    it('sets Content-Type and Content-Disposition headers and returns StreamableFile', async () => {
      const service = makeService();
      const ctrl    = new WorkflowFilesController(service as any);
      const res     = { setHeader: jest.fn() };
      const body    = {
        files: [{ storageKey: 'org/org-1/workflow-uploads/f.pdf', zipPath: 'f.pdf' }],
        title: 'Report',
      };

      const result = await ctrl.downloadZip('org-1', body as any, res as any);

      expect(service.downloadZip).toHaveBeenCalledWith('org-1', body.files, body.title);
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/zip');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="report.zip"');
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('propagates errors from service.downloadZip', async () => {
      const service = makeService();
      service.downloadZip.mockRejectedValue(new BadRequestException('No hay archivos para descargar'));
      const ctrl = new WorkflowFilesController(service as any);
      const res  = { setHeader: jest.fn() };

      await expect(
        ctrl.downloadZip('org-1', { files: [], title: 'T' } as any, res as any),
      ).rejects.toThrow('No hay archivos para descargar');
    });
  });
});

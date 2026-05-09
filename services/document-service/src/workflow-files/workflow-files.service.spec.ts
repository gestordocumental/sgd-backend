import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { WorkflowFilesService } from './workflow-files.service';

// ── Helpers ─────────────────────────────────────────────────────────────────

const PDF_MIME  = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PNG_MIME  = 'image/png';
const JPG_MIME  = 'image/jpeg';

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname:    'file',
    originalname: 'test.pdf',
    encoding:     '7bit',
    mimetype:     PDF_MIME,
    size:         1024,
    buffer:       Buffer.from('fake content'),
    destination:  '',
    filename:     '',
    path:         '',
    stream:       null as any,
    ...overrides,
  };
}

function makeStorage() {
  return {
    upload:               jest.fn().mockResolvedValue(undefined),
    getSignedDownloadUrl: jest.fn().mockResolvedValue({ url: 'https://signed.url', expiresAt: new Date() }),
  };
}

// ── WorkflowFilesService ─────────────────────────────────────────────────────

describe('WorkflowFilesService', () => {

  // ── upload() ──────────────────────────────────────────────────────────────

  describe('upload()', () => {
    it('uploads a PDF file and returns the correct DTO shape', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.upload('org-1', makeFile());

      expect(storage.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^org\/org-1\/workflow-uploads\/.+\.pdf$/),
        expect.any(Buffer),
        PDF_MIME,
      );
      expect(result.storageKey).toMatch(/^org\/org-1\/workflow-uploads\/.+\.pdf$/);
      expect(result.originalName).toBe('test.pdf');
      expect(result.mimeType).toBe(PDF_MIME);
      expect(result.fileSizeBytes).toBe(1024);
    });

    it('uploads a DOCX file', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.upload('org-1', makeFile({ mimetype: DOCX_MIME, originalname: 'doc.docx' }));

      expect(result.storageKey).toMatch(/\.docx$/);
    });

    it('uploads an XLSX file', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.upload('org-1', makeFile({ mimetype: XLSX_MIME, originalname: 'sheet.xlsx' }));

      expect(result.storageKey).toMatch(/\.xlsx$/);
    });

    it('uploads a PNG image', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.upload('org-1', makeFile({ mimetype: PNG_MIME, originalname: 'img.png' }));

      expect(result.storageKey).toMatch(/\.png$/);
    });

    it('uploads a JPEG image', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.upload('org-1', makeFile({ mimetype: JPG_MIME, originalname: 'photo.jpg' }));

      expect(result.storageKey).toMatch(/\.jpg$/);
    });

    it('throws BadRequestException for an unsupported MIME type', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      await expect(
        service.upload('org-1', makeFile({ mimetype: 'text/plain' })),
      ).rejects.toThrow(BadRequestException);

      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when file exceeds 20 MB', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      await expect(
        service.upload('org-1', makeFile({ size: 21 * 1024 * 1024 })),
      ).rejects.toThrow(BadRequestException);

      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when file is null/undefined', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      await expect(
        service.upload('org-1', null as any),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upload('org-1', undefined as any),
      ).rejects.toThrow(BadRequestException);
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('includes the orgId in the storage key path', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.upload('my-special-org', makeFile());

      expect(result.storageKey).toContain('org/my-special-org/workflow-uploads/');
    });

    it('generates a unique storage key (UUID) per upload', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const r1 = await service.upload('org-1', makeFile());
      const r2 = await service.upload('org-1', makeFile());

      expect(r1.storageKey).not.toBe(r2.storageKey);
    });
  });

  // ── getSignedUrl() ────────────────────────────────────────────────────────

  describe('getSignedUrl()', () => {
    it('returns signed URL when storageKey belongs to the org', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);
      const key     = 'org/org-1/workflow-uploads/abc.pdf';

      const result = await service.getSignedUrl('org-1', key);

      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(key);
      expect(result.signedUrl).toBe('https://signed.url');
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('throws ForbiddenException when storageKey belongs to a different org', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);
      const key     = 'org/org-other/workflow-uploads/abc.pdf';

      await expect(service.getSignedUrl('org-1', key)).rejects.toThrow(ForbiddenException);

      expect(storage.getSignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException for a key with wrong prefix structure', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      await expect(service.getSignedUrl('org-1', 'org/org-1/typologies/file.pdf')).rejects.toThrow(ForbiddenException);
    });

    it('propagates errors from storage.getSignedDownloadUrl', async () => {
      const storage = makeStorage();
      storage.getSignedDownloadUrl.mockRejectedValue(new Error('Storage unavailable'));
      const service = new WorkflowFilesService(storage as any);
      const key     = 'org/org-1/workflow-uploads/file.pdf';

      await expect(service.getSignedUrl('org-1', key)).rejects.toThrow('Storage unavailable');
    });
  });
});

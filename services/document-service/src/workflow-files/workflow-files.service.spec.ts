import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PassThrough } from 'stream';
import { WorkflowFilesService } from './workflow-files.service';

// ── Helpers ─────────────────────────────────────────────────────────────────

const PDF_MIME  = 'application/pdf';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PNG_MIME  = 'image/png';
const JPG_MIME  = 'image/jpeg';
const WEBP_MIME = 'image/webp';
const GIF_MIME  = 'image/gif';
const BMP_MIME  = 'image/bmp';
const TIFF_MIME = 'image/tiff';

// Minimal 2-entry ZIP buffers for DOCX and XLSX. validateMagicBytes() requires both
// the [Content_Types].xml first-entry and a type-specific part entry, so each format needs
// its own buffer — DOCX requires word/document.xml, XLSX requires xl/workbook.xml.
function makeOoxmlEntry(filename: string): Buffer {
  const name = Buffer.from(filename);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
  header.writeUInt16LE(name.length, 26);
  return Buffer.concat([header, name]);
}
const DOCX_MAGIC = Buffer.concat([
  makeOoxmlEntry('[Content_Types].xml'),
  makeOoxmlEntry('word/document.xml'),
]);
const XLSX_MAGIC = Buffer.concat([
  makeOoxmlEntry('[Content_Types].xml'),
  makeOoxmlEntry('xl/workbook.xml'),
]);

// Minimum valid magic bytes per MIME type so validateMagicBytes() passes in tests.
const MAGIC_BYTES: Record<string, Buffer> = {
  [PDF_MIME]:  Buffer.from([0x25, 0x50, 0x44, 0x46]),         // %PDF
  [DOCX_MIME]: DOCX_MAGIC,
  [XLSX_MIME]: XLSX_MAGIC,
  [PNG_MIME]:  Buffer.from([0x89, 0x50, 0x4E, 0x47]),         // \x89PNG
  [JPG_MIME]:  Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),         // \xFF\xD8\xFF
  // WEBP: RIFF (4 bytes) + file-size (4 bytes zero-filled) + WEBP (4 bytes) — 12 bytes total
  [WEBP_MIME]: Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]),
  [GIF_MIME]:  Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),  // GIF89a
  [BMP_MIME]:  Buffer.from([0x42, 0x4D, 0x00, 0x00]),               // BM
  [TIFF_MIME]: Buffer.from([0x49, 0x49, 0x2A, 0x00]),               // II*\x00 (little-endian)
};

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  const mimetype = overrides.mimetype ?? PDF_MIME;
  return {
    fieldname:    'file',
    originalname: 'test.pdf',
    encoding:     '7bit',
    mimetype,
    size:         1024,
    buffer:       MAGIC_BYTES[mimetype] ?? Buffer.alloc(4),
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
    downloadBuffer:       jest.fn().mockResolvedValue(Buffer.from('file content')),
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

    it('uploads a WEBP image', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.upload('org-1', makeFile({ mimetype: WEBP_MIME, originalname: 'img.webp' }));

      expect(result.storageKey).toMatch(/\.webp$/);
      expect(result.mimeType).toBe(WEBP_MIME);
    });

    it('uploads a GIF image', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.upload('org-1', makeFile({ mimetype: GIF_MIME, originalname: 'anim.gif' }));

      expect(result.storageKey).toMatch(/\.gif$/);
    });

    it('uploads a BMP image', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.upload('org-1', makeFile({ mimetype: BMP_MIME, originalname: 'img.bmp' }));

      expect(result.storageKey).toMatch(/\.bmp$/);
    });

    it('uploads a TIFF image', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.upload('org-1', makeFile({ mimetype: TIFF_MIME, originalname: 'scan.tiff' }));

      expect(result.storageKey).toMatch(/\.tiff$/);
    });

    it('throws BadRequestException with FILE_CONTENT_MISMATCH when buffer does not match declared MIME type', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      // PDF MIME declared but zero-filled buffer (no valid signature)
      const spoofed = makeFile({ buffer: Buffer.alloc(12) });

      await expect(service.upload('org-1', spoofed)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'FILE_CONTENT_MISMATCH' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws BadRequestException with FILE_CONTENT_MISMATCH for an allowed MIME with mismatched magic bytes', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      // PNG declared but JPEG magic bytes supplied
      const spoofed = makeFile({ mimetype: PNG_MIME, buffer: MAGIC_BYTES[JPG_MIME] });

      await expect(service.upload('org-1', spoofed)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'FILE_CONTENT_MISMATCH' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
    });

    it('throws BadRequestException with FILE_CONTENT_MISMATCH when DOCX bytes are submitted with XLSX MIME', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      // XLSX MIME declared but DOCX magic bytes supplied — cross-OOXML substitution
      const spoofed = makeFile({ mimetype: XLSX_MIME, buffer: DOCX_MAGIC });

      await expect(service.upload('org-1', spoofed)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'FILE_CONTENT_MISMATCH' }),
      });
      expect(storage.upload).not.toHaveBeenCalled();
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

      expect(storage.getSignedDownloadUrl).toHaveBeenCalledWith(key, undefined, undefined, true);
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

  // ── downloadZip() ─────────────────────────────────────────────────────────

  describe('downloadZip()', () => {
    it('throws BadRequestException when entries array is empty', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      await expect(service.downloadZip('org-1', [], 'Report')).rejects.toThrow(BadRequestException);
      expect(storage.downloadBuffer).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when a storageKey does not belong to the org', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      await expect(
        service.downloadZip('org-1', [
          { storageKey: 'org/org-other/workflow-uploads/file.pdf', zipPath: 'file.pdf' },
        ], 'Report'),
      ).rejects.toThrow(ForbiddenException);

      expect(storage.downloadBuffer).not.toHaveBeenCalled();
    });

    it('returns a PassThrough stream and filename for valid entries', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.downloadZip(
        'org-1',
        [{ storageKey: 'org/org-1/workflow-uploads/file.pdf', zipPath: 'docs/file.pdf' }],
        'My Report',
      );

      expect(result.filename).toBe('My Report.zip');
      expect(result.stream).toBeInstanceOf(PassThrough);
      expect(storage.downloadBuffer).toHaveBeenCalledWith('org/org-1/workflow-uploads/file.pdf');
    });

    it('downloads all files concurrently when multiple entries are provided', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);
      const entries = [
        { storageKey: 'org/org-1/workflow-uploads/a.pdf', zipPath: 'a.pdf' },
        { storageKey: 'org/org-1/workflow-uploads/b.pdf', zipPath: 'b.pdf' },
      ];

      await service.downloadZip('org-1', entries, 'Bundle');

      expect(storage.downloadBuffer).toHaveBeenCalledTimes(2);
      expect(storage.downloadBuffer).toHaveBeenCalledWith('org/org-1/workflow-uploads/a.pdf');
      expect(storage.downloadBuffer).toHaveBeenCalledWith('org/org-1/workflow-uploads/b.pdf');
    });

    it('sanitizes special characters in the title for the filename', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      const result = await service.downloadZip(
        'org-1',
        [{ storageKey: 'org/org-1/workflow-uploads/f.pdf', zipPath: 'f.pdf' }],
        'Report: "Test" / 2025',
      );

      expect(result.filename).not.toContain(':');
      expect(result.filename).not.toContain('"');
      expect(result.filename).not.toContain('/');
      expect(result.filename).toMatch(/\.zip$/);
    });

    it('throws BadRequestException for a path traversal zipPath', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      await expect(
        service.downloadZip(
          'org-1',
          [{ storageKey: 'org/org-1/workflow-uploads/f.pdf', zipPath: '../../../etc/passwd' }],
          'Safe',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for a Windows-style path traversal zipPath', async () => {
      const storage = makeStorage();
      const service = new WorkflowFilesService(storage as any);

      await expect(
        service.downloadZip(
          'org-1',
          [{ storageKey: 'org/org-1/workflow-uploads/f.pdf', zipPath: '..\\..\\etc\\passwd' }],
          'Safe',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

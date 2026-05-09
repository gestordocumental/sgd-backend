import { BadRequestException } from '@nestjs/common';
import { DocumentUploadController } from './document-upload.controller';
import { DocumentUploadResponseDto } from './dto/document-upload-response.dto';
import { SignedUrlResponseDto } from './dto/signed-url-response.dto';
import { TypologyResponseDto } from '../typologies/dto/typology-response.dto';
import { ExtractionStatus } from '../typologies/schemas/typology.schema';

// ── Helpers ─────────────────────────────────────────────────────────────────

const PDF_MIME = 'application/pdf';

function makeFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname:    'file',
    originalname: 'test.pdf',
    encoding:     '7bit',
    mimetype:     PDF_MIME,
    size:         1024,
    buffer:       Buffer.from('fake pdf'),
    destination:  '',
    filename:     '',
    path:         '',
    stream:       null as any,
    ...overrides,
  };
}

function makeUploadResponse(): DocumentUploadResponseDto {
  return {
    r2Key:            'org/org-1/typologies/uuid.pdf',
    originalName:     'test.pdf',
    mimeType:         PDF_MIME,
    uploadedAt:       new Date(),
    extractionStatus: ExtractionStatus.PROCESSING,
  } as any;
}

function makeSignedUrlResponse(): SignedUrlResponseDto {
  return {
    signedUrl: 'https://signed.url/file.pdf',
    expiresAt: new Date(),
  } as any;
}

function makeService() {
  return {
    upload:           jest.fn().mockResolvedValue(makeUploadResponse()),
    retryExtraction:  jest.fn().mockResolvedValue({ message: 'Extracción reencolada.', extractionStatus: 'PROCESSING' }),
    getSignedUrl:     jest.fn().mockResolvedValue(makeSignedUrlResponse()),
    createNewVersion: jest.fn().mockResolvedValue({} as TypologyResponseDto),
  };
}

// ── DocumentUploadController ─────────────────────────────────────────────────

describe('DocumentUploadController', () => {
  describe('upload()', () => {
    it('delegates to service.upload and returns the result', async () => {
      const service = makeService();
      const ctrl    = new DocumentUploadController(service as any);
      const file    = makeFile();

      const result = await ctrl.upload('org-1', 'typo-id-1', file, 'Helisa SAS');

      expect(service.upload).toHaveBeenCalledWith('org-1', 'typo-id-1', file, 'Helisa SAS');
      expect(result).toMatchObject({ extractionStatus: ExtractionStatus.PROCESSING });
    });

    it('delegates without orgName when not provided', async () => {
      const service = makeService();
      const ctrl    = new DocumentUploadController(service as any);

      await ctrl.upload('org-1', 'typo-id-1', makeFile());

      expect(service.upload).toHaveBeenCalledWith('org-1', 'typo-id-1', expect.any(Object), undefined);
    });

    it('throws BadRequestException when no file is provided', async () => {
      const service = makeService();
      const ctrl    = new DocumentUploadController(service as any);

      await expect(
        ctrl.upload('org-1', 'typo-id-1', undefined as any),
      ).rejects.toThrow(BadRequestException);

      expect(service.upload).not.toHaveBeenCalled();
    });
  });

  describe('retryExtraction()', () => {
    it('delegates to service.retryExtraction and returns the result', async () => {
      const service = makeService();
      const ctrl    = new DocumentUploadController(service as any);

      const result = await ctrl.retryExtraction('org-1', 'typo-id-1', 'Helisa SAS');

      expect(service.retryExtraction).toHaveBeenCalledWith('org-1', 'typo-id-1', 'Helisa SAS');
      expect(result).toEqual({ message: 'Extracción reencolada.', extractionStatus: 'PROCESSING' });
    });

    it('delegates without orgName when not provided', async () => {
      const service = makeService();
      const ctrl    = new DocumentUploadController(service as any);

      await ctrl.retryExtraction('org-1', 'typo-id-1');

      expect(service.retryExtraction).toHaveBeenCalledWith('org-1', 'typo-id-1', undefined);
    });
  });

  describe('getSignedUrl()', () => {
    it('delegates to service.getSignedUrl and returns the result', async () => {
      const service = makeService();
      const ctrl    = new DocumentUploadController(service as any);

      const result = await ctrl.getSignedUrl('org-1', 'typo-id-1');

      expect(service.getSignedUrl).toHaveBeenCalledWith('org-1', 'typo-id-1');
      expect(result).toMatchObject({ signedUrl: 'https://signed.url/file.pdf' });
    });

    it('propagates errors from service.getSignedUrl', async () => {
      const service = makeService();
      service.getSignedUrl.mockRejectedValue(new Error('Not found'));
      const ctrl = new DocumentUploadController(service as any);

      await expect(ctrl.getSignedUrl('org-1', 'typo-id-1')).rejects.toThrow('Not found');
    });
  });

  describe('createNewVersion()', () => {
    it('delegates to service.createNewVersion with correct params', async () => {
      const service = makeService();
      const ctrl    = new DocumentUploadController(service as any);
      const file    = makeFile();

      await ctrl.createNewVersion('org-1', 'typo-id-1', file, 'New Name', '02', 'Helisa SAS');

      expect(service.createNewVersion).toHaveBeenCalledWith(
        'org-1',
        'typo-id-1',
        file,
        { nombre: 'New Name', version: '02', orgName: 'Helisa SAS' },
      );
    });

    it('throws BadRequestException when no file is provided', async () => {
      const service = makeService();
      const ctrl    = new DocumentUploadController(service as any);

      await expect(
        ctrl.createNewVersion('org-1', 'typo-id-1', undefined as any),
      ).rejects.toThrow(BadRequestException);

      expect(service.createNewVersion).not.toHaveBeenCalled();
    });

    it('passes undefined optional params when not provided', async () => {
      const service = makeService();
      const ctrl    = new DocumentUploadController(service as any);

      await ctrl.createNewVersion('org-1', 'typo-id-1', makeFile());

      expect(service.createNewVersion).toHaveBeenCalledWith(
        'org-1',
        'typo-id-1',
        expect.any(Object),
        { nombre: undefined, version: undefined, orgName: undefined },
      );
    });
  });
});

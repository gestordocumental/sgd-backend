import { BadRequestException } from '@nestjs/common';

// Note: application/msword (.doc binary) is intentionally excluded — the extractor
// only supports OOXML (.docx). A legacy .doc file would cause a silent parse failure.
export const ALLOWED_MIMETYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export const multerFileFilter = (
  _req: any,
  file: Express.Multer.File,
  cb: (error: Error | null, acceptFile: boolean) => void,
) => {
  // Multer decodes multipart Content-Disposition filenames as Latin-1 per the HTTP spec,
  // but browsers actually send UTF-8 bytes. Re-interpret to recover accented characters.
  file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');

  if (ALLOWED_MIMETYPES[file.mimetype]) cb(null, true);
  else cb(new BadRequestException('Format not allowed. Use PDF, DOCX or XLSX.'), false);
};

export const multerOptions = {
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: multerFileFilter,
};

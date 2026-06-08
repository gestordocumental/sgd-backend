import { BadRequestException } from '@nestjs/common';

// Note: application/msword (.doc binary) is intentionally excluded — the extractor
// only supports OOXML (.docx). A legacy .doc file would cause a silent parse failure.
export const ALLOWED_MIMETYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

/**
 * Validates that the actual file content matches the declared MIME type by inspecting
 * magic bytes (file signatures). Multer only trusts the Content-Type header, which can
 * be spoofed — this check prevents a malicious file from being accepted as PDF/DOCX/XLSX.
 *
 * DOCX and XLSX are both ZIP-based OOXML containers and share the same PK signature;
 * the MIME type declaration distinguishes them, while magic bytes confirm "this is a ZIP".
 */
export function validateMagicBytes(buffer: Buffer, mimetype: string): boolean {
  if (buffer.length < 4) return false;
  const b = buffer;

  switch (mimetype) {
    case 'application/pdf':
      // %PDF
      return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      // PK\x03\x04 — ZIP local file header (both DOCX and XLSX are OOXML/ZIP)
      return b[0] === 0x50 && b[1] === 0x4B && b[2] === 0x03 && b[3] === 0x04;
    case 'image/png':
      // \x89PNG
      return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
    case 'image/jpeg':
      // \xFF\xD8\xFF
      return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
    case 'image/webp':
      // RIFF....WEBP
      return (
        b.length >= 12 &&
        b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50   // WEBP
      );
    case 'image/gif':
      // GIF8
      return b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38;
    case 'image/bmp':
      // BM
      return b[0] === 0x42 && b[1] === 0x4D;
    case 'image/tiff':
      // II*\x00 (little-endian) or MM\x00* (big-endian)
      return (
        (b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2A && b[3] === 0x00) ||
        (b[0] === 0x4D && b[1] === 0x4D && b[2] === 0x00 && b[3] === 0x2A)
      );
    default:
      return false;
  }
}

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

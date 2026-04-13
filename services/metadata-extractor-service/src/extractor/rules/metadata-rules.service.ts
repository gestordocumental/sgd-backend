import { Injectable } from '@nestjs/common';

export interface ExtractedMetadata {
  nombre:  string | null;
  codigo:  string | null;
  version: string | null;
}

/**
 * MetadataRulesService — applies regex patterns to extract metadata from plain text.
 *
 * Patterns look for common label + value formats found in corporate document templates.
 * Examples of supported formats:
 *   "Nombre: Procedimiento de Gestión de Usuarios"
 *   "CÓDIGO: POL-SEG-ISO-001"
 *   "Versión: 1.0"
 *   "Version 2"
 *   "DOCUMENT CODE: HR-001"
 */
@Injectable()
export class MetadataRulesService {
  // ─── Nombre / Title ──────────────────────────────────────────────────────
  private readonly nombrePatterns = [
    /(?:nombre(?:\s+del?\s+documento)?|title|t[ií]tulo)\s*[:\-]\s*(.+)/i,
    /^(.{10,120})\s*\n/m, // first substantial line as fallback
  ];

  // ─── Código / Code ───────────────────────────────────────────────────────
  private readonly codigoPatterns = [
    /(?:c[oó]digo(?:\s+del?\s+documento)?|code|document\s+code|ref(?:erencia)?)\s*[:\-]\s*([A-Z0-9][A-Z0-9\-_.]{2,50})/i,
    /\b([A-Z]{2,6}-[A-Z0-9]{2,10}-[A-Z0-9\-]{2,20})\b/, // pattern like POL-SEG-ISO-001
  ];

  // ─── Versión / Version ───────────────────────────────────────────────────
  private readonly versionPatterns = [
    /(?:versi[oó]n|version|rev(?:isi[oó]n)?|v\.?)\s*[:\-]?\s*([\d]+(?:[.,]\d+)?)/i,
    /\bv([\d]+(?:[.,]\d+)?)\b/i,
  ];

  extract(text: string): ExtractedMetadata {
    return {
      nombre:  this.applyPatterns(text, this.nombrePatterns),
      codigo:  this.applyPatterns(text, this.codigoPatterns),
      version: this.applyPatterns(text, this.versionPatterns),
    };
  }

  private applyPatterns(text: string, patterns: RegExp[]): string | null {
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match?.[1]) {
        return match[1].trim().replace(/\s+/g, ' ').substring(0, 255);
      }
    }
    return null;
  }
}

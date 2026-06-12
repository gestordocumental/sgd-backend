import { Injectable } from '@nestjs/common';

export interface ExtractedMetadata {
  nombre:  string | null;
  codigo:  string | null;
  version: string | null;
}

export interface ExtractionInput {
  text:       string;
  titleCell?: string | null;  // Document title extracted directly (no company mixed in)
  leftCell?:  string | null;  // Company + title mixed (fallback when titleCell not available)
  rightCell?: string | null;  // Metadata cell (Código, Versión…)
  orgName?:   string | null;  // Organization name to filter from leftCell
}

@Injectable()
export class MetadataRulesService {
  // ─── Código / Code ───────────────────────────────────────────────────────
  private readonly codigoLabelPatterns = [
    // eslint-disable-next-line no-useless-escape, security/detect-unsafe-regex
    /(?:c[oó]digo(?:\s+del?\s+documento)?|code|document\s+code|ref(?:erencia)?)\s*[:\-]\s*([A-Z0-9][A-Z0-9\-_.]{2,50})/i,
  ];
  private readonly codigoFallbackPatterns = [
    // eslint-disable-next-line no-useless-escape
    /\b([A-Z]{2,6}-(?:[A-Z]-)?[A-Z0-9]{1,6}-[A-Z0-9\-]{2,20})\b/,
    // eslint-disable-next-line no-useless-escape
    /\b([A-Z]{2,6}-[A-Z0-9\-]{3,20})\b/,
  ];

  // ─── Versión / Version ───────────────────────────────────────────────────
  private readonly versionPatterns = [
    // eslint-disable-next-line no-useless-escape, security/detect-unsafe-regex
    /(?:versi[oó]n|version|rev(?:isi[oó]n)?|v\.?)\s*[:\-]?\s*([\d]+(?:[.,]\d+)?)/i,
    // eslint-disable-next-line security/detect-unsafe-regex
    /\bv([\d]+(?:[.,]\d+)?)\b/i,
  ];

  // ─── Nombre / Title — document-type words used in pass 2 of header analysis ─
  private readonly docTypeWords =
    /manual|procedimiento|instructivo|formato|pol[ií]tica|gu[ií]a|protocolo|plan\s+de|reglamento|contrato|acuerdo/i;

  // Company suffix heuristic — lines containing these are likely company names
  private readonly companySuffixRe =
    /\b(s\.?\s*a\.?\s*s?\.?|ltda\.?|corp\.?|inc\.?|s\.?\s*a\.?|cia\.?|grupo|holding|s\s*a\s*s)\b/i;

  extract(input: ExtractionInput): ExtractedMetadata {
    const { text, titleCell, leftCell, rightCell, orgName } = input;

    const searchScope = rightCell ? `${rightCell}\n${text}` : text;

    return {
      codigo:  this.extractCodigo(rightCell ?? null, text),
      version: this.applyPatterns(searchScope, this.versionPatterns),
      nombre:  this.extractNombre(titleCell ?? null, leftCell ?? null, text, orgName ?? null),
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private extractCodigo(rightCell: string | null, fullText: string): string | null {
    // 1. Label patterns in right cell (highest confidence)
    if (rightCell) {
      const fromCell = this.applyPatterns(rightCell, this.codigoLabelPatterns);
      if (fromCell) return fromCell;
    }
    // 2. Label patterns in full text
    const fromText = this.applyPatterns(fullText, this.codigoLabelPatterns);
    if (fromText) return fromText;
    // 3. Pattern detection in right cell
    if (rightCell) {
      const fromCellFallback = this.applyPatterns(rightCell, this.codigoFallbackPatterns);
      if (fromCellFallback) return fromCellFallback;
    }
    // 4. Pattern detection in full text
    return this.applyPatterns(fullText, this.codigoFallbackPatterns);
  }

  private extractNombre(
    titleCell: string | null,
    leftCell: string | null,
    fullText: string,
    orgName: string | null,
  ): string | null {
    // 1. Structured title cell from DOCX/XLSX header — highest confidence
    if (titleCell?.trim()) return titleCell.trim().substring(0, 255);
    // 2. Left cell (DOCX/XLSX) with company name filtering
    if (leftCell) {
      const title = this.extractTitleFromLeftCell(leftCell, orgName);
      if (title) return title;
    }
    // 3. Header analysis on plain text (PDF and any unstructured document):
    //    ignore company names, codes, versions, dates and table headers;
    //    prefer lines that carry the official document name.
    return this.extractTitleFromText(fullText, orgName);
  }

  /**
   * Extracts the document title from plain text by applying three passes:
   *
   * Pass 1 — explicit label  : "Nombre del documento: X", "Título: X"
   * Pass 2 — document type   : "Formato de X", "Manual de X", "Procedimiento de X"…
   *                            Works anywhere in the text — pdf-parse sometimes places
   *                            body content before header content in the stream.
   * Pass 3 — elimination     : first line that is NOT a company name, code, version,
   *                            date, or table-column header.
   */
  private extractTitleFromText(text: string, orgName: string | null): string | null {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length >= 3);

    // Pass 1 — explicit label ("Nombre del documento: Política de Seguridad")
    for (const line of lines) {
      const m = line.match(
        // eslint-disable-next-line security/detect-unsafe-regex
        /(?:nombre(?:\s+del?\s+documento)?|t[ií]tulo|title)\s*[:-]\s*(.{5,150})/i,
      );
      if (m?.[1]) return m[1].trim().substring(0, 255);
    }

    // Pass 2a — line that STARTS with a document type word (highest confidence for PDF headers).
    // Catches titles like "Política control de documentos y registros" that begin with
    // a docTypeWord but don't follow the "de/del/para" structure, and avoids matching
    // mid-sentence references like "...P-M-001 Manual de Control de Documentos y Registros."
    // eslint-disable-next-line security/detect-unsafe-regex
    const docTypeStartPattern = new RegExp(
      `^((?:${this.docTypeWords.source})\\b(?!\\s*[:\\-])[^#:\\n]{4,})`,
      'i',
    );
    for (const line of lines) {
      if (this.isMetadataLine(line, orgName)) continue;
      const m = line.match(docTypeStartPattern);
      if (m?.[1]) return m[1].trim().substring(0, 255);
    }

    // Pass 2 — document-type word followed by "de / del / para"
    // ("Formato de Requisición de Compras", "Manual de Calidad", etc.)
    // Uses (?:^|\s) so it matches even when merged on the same line as the company name.
    // Stops at ":" or "#" to avoid capturing trailing code/column text.
    // eslint-disable-next-line security/detect-unsafe-regex
    const docTypePattern = new RegExp(
      `(?:^|\\s)((?:${this.docTypeWords.source})\\s+(?:de[l]?|para)\\s+[^#:\\n]{5,})`,
      'im',
    );
    for (const line of lines) {
      const m = line.match(docTypePattern);
      if (m?.[1]) return m[1].trim().substring(0, 255);
    }

    // Pass 3 — elimination: skip every line that is clearly metadata, then return the first
    // remaining candidate of at least 10 characters.
    for (const line of lines) {
      if (line.length >= 10 && !this.looksLikeTableHeader(line) && !this.isMetadataLine(line, orgName)) {
        return line.substring(0, 255);
      }
    }

    return null;
  }

  /**
   * Returns true when a line is recognisable as document metadata rather than a title:
   * company names, standalone codes, version labels, dates, or page indicators.
   */
  private isMetadataLine(line: string, orgName: string | null): boolean {
    if (this.looksLikeCompanyLine(line, orgName)) return true;
    // Standalone document code: "AD-C-F-002"
    // eslint-disable-next-line security/detect-unsafe-regex
    if (/^[A-ZÁÉÍÓÚÑ]{1,8}(?:-[A-ZÁÉÍÓÚÑ0-9]{1,8}){1,6}$/.test(line)) return true;
    // Labeled metadata fields: "Código: …", "Versión: …", "Fecha: …"
    if (/^(?:c[oó]digo|versi[oó]n|version|fecha|date|rev(?:isi[oó]n)?|elabor|aprob|vigencia)\s*[:-]/i.test(line)) return true;
    // Raw date value: "16/04/2026", "2026-04-16"
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/.test(line)) return true;
    // Version-only line: "V10", "v1.0", "10"
    // eslint-disable-next-line security/detect-unsafe-regex
    if (/^v\.?\s*\d+(?:[.,]\d+)?$/i.test(line) || /^\d+(?:[.,]\d+)?$/.test(line)) return true;
    // Page indicators: "Página 1", "1 de 5"
    if (/^(?:p[aá]gina|page)\s*\d|^\d+\s*(?:de|of)\s*\d+$/i.test(line)) return true;
    return false;
  }

  /**
   * Given the left cell text (which contains company name + document title),
   * filter out lines that look like company names and return the remainder as the title.
   */
  private extractTitleFromLeftCell(leftCell: string, orgName: string | null): string | null {
    const lines = leftCell.split('\n').map((l) => l.trim()).filter(Boolean);

    const titleLines = lines.filter((line) => !this.looksLikeCompanyLine(line, orgName));

    const title = titleLines.join(' ').trim();
    return title.length >= 3 ? title.substring(0, 255) : null;
  }

  private looksLikeCompanyLine(line: string, orgName: string | null): boolean {
    // Exact or fuzzy match against known org name
    if (orgName) {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const normLine = normalize(line);
      const normOrg  = normalize(orgName);
      if (normLine === normOrg || normLine.includes(normOrg) || normOrg.includes(normLine)) {
        return true;
      }
    }
    // Contains common company legal suffixes
    if (this.companySuffixRe.test(line)) return true;
    // All-caps 1-2 token text: company abbreviation (e.g. "ACME", "GD CORP").
    // Capped at 2 tokens so multi-word titles in uppercase (e.g. "MANUAL DE CALIDAD") are not discarded.
    if (line === line.toUpperCase() && line.split(/\s+/).length <= 2 && line.length < 30) {
      return true;
    }
    return false;
  }

  /**
   * Returns true for lines that look like table/form column headers rather than document titles.
   * Used to skip false positives in the first-line fallback.
   */
  private looksLikeTableHeader(line: string): boolean {
    // Contains a standalone # — column ordinal marker (e.g. "Nombre Ítem #CANTIDAD")
    if (line.includes('#')) return true;
    // 3+ tokens all in UPPERCASE with no lowercase letters — typical column header row
    const tokens = line.split(/\s+/).filter(Boolean);
    if (
      tokens.length >= 3 &&
      tokens.every((t) => t === t.toUpperCase() && /^[A-ZÁÉÍÓÚÑ/\d]{2,}$/.test(t))
    ) {
      return true;
    }
    return false;
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

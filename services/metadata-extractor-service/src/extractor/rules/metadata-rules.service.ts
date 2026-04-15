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
    /(?:c[oó]digo(?:\s+del?\s+documento)?|code|document\s+code|ref(?:erencia)?)\s*[:\-]\s*([A-Z0-9][A-Z0-9\-_.]{2,50})/i,
  ];
  private readonly codigoFallbackPatterns = [
    /\b([A-Z]{2,6}-(?:[A-Z]-)?[A-Z0-9]{1,6}-[A-Z0-9\-]{2,20})\b/,
    /\b([A-Z]{2,6}-[A-Z0-9\-]{3,20})\b/,
  ];

  // ─── Versión / Version ───────────────────────────────────────────────────
  private readonly versionPatterns = [
    /(?:versi[oó]n|version|rev(?:isi[oó]n)?|v\.?)\s*[:\-]?\s*([\d]+(?:[.,]\d+)?)/i,
    /\bv([\d]+(?:[.,]\d+)?)\b/i,
  ];

  // ─── Nombre / Title ——————————————————————————————————————————————————————
  private readonly nombreLabelPatterns = [
    /(?:nombre(?:\s+del?\s+documento)?|title|t[ií]tulo|proceso|formato)\s*[:\-]\s*(.+)/i,
  ];

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
    // 1. Title cell extracted directly from header — no filtering needed
    if (titleCell?.trim()) return titleCell.trim().substring(0, 255);
    // 2. Left cell contains company + title mixed — filter company lines
    if (leftCell) {
      const title = this.extractTitleFromLeftCell(leftCell, orgName);
      if (title) return title;
    }
    // 3. Label pattern in full text
    const fromLabel = this.applyPatterns(fullText, this.nombreLabelPatterns);
    if (fromLabel) return fromLabel;
    // 4. Last resort — first substantial line of the document
    const firstLine = fullText.split('\n').map((l) => l.trim()).find((l) => l.length >= 10);
    return firstLine ? firstLine.substring(0, 255) : null;
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
    // All-caps short text (typical company abbreviation)
    if (line === line.toUpperCase() && line.split(/\s+/).length <= 5 && line.length < 50) {
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

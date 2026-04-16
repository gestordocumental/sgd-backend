import { MetadataRulesService } from './metadata-rules.service';

// MetadataRulesService is a pure service with no dependencies — instantiated directly.
const rules = new MetadataRulesService();

// ── extract() ─────────────────────────────────────────────────────────────────

describe('MetadataRulesService', () => {

  // ── codigo ──────────────────────────────────────────────────────────────────

  describe('codigo extraction', () => {
    it('extracts codigo from label in rightCell (highest priority)', () => {
      const result = rules.extract({
        text:      'Some document body',
        rightCell: 'Código: POL-SEG-001\nVersión: v1.0',
      });
      expect(result.codigo).toBe('POL-SEG-001');
    });

    it('extracts codigo from label in full text when no rightCell', () => {
      const result = rules.extract({
        text: 'Código del documento: IT-HR-001\nSome other content',
      });
      expect(result.codigo).toBe('IT-HR-001');
    });

    it('falls back to pattern detection in rightCell when no label found', () => {
      const result = rules.extract({
        text:      'No code here',
        rightCell: 'POL-001\nv1.0',
      });
      expect(result.codigo).toBe('POL-001');
    });

    it('falls back to pattern detection in full text (last resort)', () => {
      const result = rules.extract({
        text: 'Document reference POL-SEC-2024 is attached',
      });
      expect(result.codigo).toBe('POL-SEC-2024');
    });

    it('returns null when no codigo pattern matches', () => {
      const result = rules.extract({
        text: 'This document has no code in it at all.',
      });
      expect(result.codigo).toBeNull();
    });
  });

  // ── version ─────────────────────────────────────────────────────────────────

  describe('version extraction', () => {
    it('extracts version with "Versión:" label', () => {
      const result = rules.extract({
        text: 'Versión: 1.0',
      });
      expect(result.version).toBe('1.0');
    });

    it('extracts version with "Version:" label (English)', () => {
      const result = rules.extract({
        text: 'Version: 2.1',
      });
      expect(result.version).toBe('2.1');
    });

    it('extracts version with "Rev:" prefix', () => {
      const result = rules.extract({
        text: 'Rev: 3',
      });
      expect(result.version).toBe('3');
    });

    it('extracts version from "v1.0" shorthand', () => {
      const result = rules.extract({
        text: 'Document v1.0 approved',
      });
      expect(result.version).toBe('1.0');
    });

    it('prefers rightCell over full text for version', () => {
      const result = rules.extract({
        text:      'versión: 5.0',
        rightCell: 'versión: 2.0',
      });
      expect(result.version).toBe('2.0');
    });

    it('returns null when no version found', () => {
      const result = rules.extract({
        text: 'Just a plain document with no version info.',
      });
      expect(result.version).toBeNull();
    });
  });

  // ── nombre ───────────────────────────────────────────────────────────────────

  describe('nombre extraction', () => {
    it('uses titleCell directly (highest priority)', () => {
      const result = rules.extract({
        text:      'Política de Seguridad',
        titleCell: 'Security Policy Manual',
      });
      expect(result.nombre).toBe('Security Policy Manual');
    });

    it('extracts title from leftCell after filtering company lines', () => {
      const result = rules.extract({
        text:     'Some body',
        leftCell: 'Helisa SAS\nSecurity Policy',
        orgName:  'Helisa SAS',
      });
      expect(result.nombre).toBe('Security Policy');
    });

    it('filters company suffixes (S.A.S) from leftCell', () => {
      const result = rules.extract({
        text:     'Body text',
        leftCell: 'Acme S.A.S\nTraining Manual',
      });
      expect(result.nombre).toBe('Training Manual');
    });

    it('falls back to label pattern in full text', () => {
      const result = rules.extract({
        text: 'Nombre del documento: Information Security Policy\nVersion: 1.0',
      });
      expect(result.nombre).toBe('Information Security Policy');
    });

    it('uses first substantial line as last resort', () => {
      const result = rules.extract({
        text: '\n\nInformation Security Policy Document\nSome content here',
      });
      expect(result.nombre).toBe('Information Security Policy Document');
    });

    it('returns null when text is too short for last-resort extraction', () => {
      const result = rules.extract({
        text: 'Hi',
      });
      expect(result.nombre).toBeNull();
    });

    it('trims titleCell and caps at 255 chars', () => {
      const longTitle = 'A'.repeat(300);
      const result = rules.extract({
        text:      'body',
        titleCell: `  ${longTitle}  `,
      });
      expect(result.nombre).toHaveLength(255);
    });

    it('ignores all-caps 1-2 token text in leftCell (company abbreviation heuristic)', () => {
      const result = rules.extract({
        text:     'body',
        leftCell: 'ACME CORP\nDocument Title Here',
      });
      expect(result.nombre).toBe('Document Title Here');
    });

    it('does NOT discard multi-word all-caps titles (e.g. "MANUAL DE CALIDAD")', () => {
      const result = rules.extract({
        text:     'body',
        leftCell: 'MANUAL DE CALIDAD',
      });
      expect(result.nombre).toBe('MANUAL DE CALIDAD');
    });
  });

  // ── full extraction ──────────────────────────────────────────────────────────

  describe('full extraction (all three fields)', () => {
    it('extracts all three fields from a realistic document', () => {
      const result = rules.extract({
        text: [
          'Código: POL-SEG-001',
          'Versión: 1.2',
          'Título: Information Security Policy',
        ].join('\n'),
      });
      expect(result.codigo).toBe('POL-SEG-001');
      expect(result.version).toBe('1.2');
      expect(result.nombre).toBe('Information Security Policy');
    });

    it('returns all nulls for empty text', () => {
      const result = rules.extract({ text: '' });
      expect(result.codigo).toBeNull();
      expect(result.version).toBeNull();
      expect(result.nombre).toBeNull();
    });

    it('uses structured header cells when all three are present', () => {
      const result = rules.extract({
        text:      'Full document text here to search in.',
        titleCell: 'HR Onboarding Process',
        rightCell: 'Código: HR-ONB-2024\nVersión: 3.0',
      });
      expect(result.nombre).toBe('HR Onboarding Process');
      expect(result.codigo).toBe('HR-ONB-2024');
      expect(result.version).toBe('3.0');
    });
  });
});

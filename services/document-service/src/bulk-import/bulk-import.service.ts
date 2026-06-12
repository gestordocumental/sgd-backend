import { Injectable, BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { TypologiesService } from '../typologies/typologies.service';
import { OrgClientService, ResolveStructureItem } from '../common/org-client/org-client.service';
import { CreationSource } from '../typologies/schemas/typology.schema';
import { AppLogger } from '@sgd/common';

const MAX_ROWS = 500;

export interface BulkImportError {
  row: number;
  department?: string;
  area?: string;
  position?: string;
  nombre?: string;
  codigo?: string;
  reason: string;
}

export interface BulkImportResult {
  totalRows: number;
  created: number;
  failed: number;
  errors: BulkImportError[];
}

interface ExcelRow {
  rowNumber: number;
  department: string;
  area?: string;
  position?: string;
  nombre: string;
  codigo: string;
  version: string;
}

@Injectable()
export class BulkImportService {
  constructor(
    private readonly typologiesService: TypologiesService,
    private readonly orgClient: OrgClientService,
    private readonly logger: AppLogger,
  ) {}

  async importFromExcel(orgId: string, buffer: Buffer): Promise<BulkImportResult> {
    const rows = await this.parseExcel(buffer);

    if (rows.length === 0) throw new BadRequestException('El archivo Excel no contiene filas válidas');
    if (rows.length > MAX_ROWS) throw new BadRequestException(`El archivo excede el máximo de ${MAX_ROWS} filas`);

    const result: BulkImportResult = { totalRows: rows.length, created: 0, failed: 0, errors: [] };

    // Step 1 — deduplicate structure combinations
    const uniqueItems = this.extractUniqueStructureItems(rows);

    // Step 2 — resolve all structure names → IDs in a single call
    const resolveResult = await this.orgClient.resolveStructure(orgId, uniqueItems);

    // Build lookup map: "dept|area|position" → resolved IDs
    const resolvedMap = new Map<string, { departamentoId: string; departamentoNombre: string; areaId: string | null; areaNombre: string | null; cargoId: string | null; cargoNombre: string | null }>();
    const unresolvedSet = new Map<string, string>(); // key → reason

    for (const item of resolveResult.resolved) {
      const srcItem = uniqueItems[item.index];
      const key = this.structureKey(srcItem);
      resolvedMap.set(key, {
        departamentoId:    item.departamentoId,
        departamentoNombre: srcItem.department,
        areaId:            item.areaId,
        areaNombre:        srcItem.area ?? null,
        cargoId:           item.cargoId,
        cargoNombre:       srcItem.position ?? null,
      });
    }

    for (const item of resolveResult.unresolved) {
      const srcItem = uniqueItems[item.index];
      unresolvedSet.set(this.structureKey(srcItem), item.reason);
    }

    // Step 3 — create typologies for resolved rows
    for (const row of rows) {
      const key = this.structureKey({ department: row.department, area: row.area, position: row.position });
      const structureNames = resolvedMap.get(key);

      if (!structureNames) {
        result.failed++;
        result.errors.push({
          row: row.rowNumber,
          department: row.department,
          area: row.area,
          position: row.position,
          nombre: row.nombre,
          codigo: row.codigo,
          reason: unresolvedSet.get(key) ?? 'Estructura organizacional no encontrada',
        });
        continue;
      }

      try {
        await this.typologiesService.create(
          orgId,
          { departamentoId: structureNames.departamentoId, areaId: structureNames.areaId ?? undefined, cargoId: structureNames.cargoId ?? undefined, nombre: row.nombre, codigo: row.codigo, version: row.version },
          structureNames,
          CreationSource.BULK_IMPORT,
        );
        result.created++;
      } catch (err: any) {
        result.failed++;
        result.errors.push({
          row: row.rowNumber,
          nombre: row.nombre,
          codigo: row.codigo,
          reason: err?.message ?? 'Error al crear la tipología',
        });
        this.logger.warn(`Bulk import row ${row.rowNumber} failed: ${err?.message}`, 'BulkImportService');
      }
    }

    return result;
  }

  private extractUniqueStructureItems(rows: ExcelRow[]): ResolveStructureItem[] {
    const seen = new Set<string>();
    const items: ResolveStructureItem[] = [];

    for (const row of rows) {
      const item: ResolveStructureItem = { department: row.department, area: row.area, position: row.position };
      const key = this.structureKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        items.push(item);
      }
    }
    return items;
  }

  private structureKey(item: { department: string; area?: string; position?: string }): string {
    return `${item.department}|${item.area ?? ''}|${item.position ?? ''}`;
  }

  private async parseExcel(buffer: Buffer): Promise<ExcelRow[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException('El archivo Excel no tiene hojas de cálculo');

    // rowCount includes the header; reject before iterating all rows when clearly over the limit.
    if (worksheet.rowCount - 1 > MAX_ROWS) {
      throw new BadRequestException(`El archivo excede el máximo de ${MAX_ROWS} filas`);
    }

    const rows: ExcelRow[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const department = this.cellStr(row.getCell(1));
      const area       = this.cellStr(row.getCell(2));
      const position   = this.cellStr(row.getCell(3));
      const nombre     = this.cellStr(row.getCell(4));
      const codigo     = this.cellStr(row.getCell(5));
      const version    = this.cellStr(row.getCell(6));

      // Rows without department or without typology data are skipped
      if (!department || !nombre || !codigo || !version) return;

      rows.push({
        rowNumber,
        department,
        ...(area     ? { area }     : {}),
        ...(position ? { position } : {}),
        nombre,
        codigo,
        version,
      });
    });

    return rows;
  }

  private cellStr(cell: ExcelJS.Cell): string | undefined {
    const raw = cell.value;
    if (raw === null || raw === undefined) return undefined;
    const str = String(raw).trim();
    return str.length > 0 ? str : undefined;
  }
}

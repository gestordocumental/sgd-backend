import { Injectable, BadRequestException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as ExcelJS from "exceljs";
import { Departamento } from "./entities/departamento.entity";
import { Area } from "./entities/area.entity";
import { Cargo } from "./entities/cargo.entity";
import {
  BulkStructureResponseDto,
  BulkStructureRowError,
} from "./dto/bulk-structure-response.dto";
import {
  ResolveStructureRequestDto,
  ResolveStructureItemDto,
} from "./dto/resolve-structure-request.dto";
import {
  ResolveStructureResponseDto,
  ResolvedStructureItem,
  UnresolvedStructureItem,
} from "./dto/resolve-structure-response.dto";
import { AppLogger } from "../common/logger/app-logger.service";

const MAX_ROWS = 500;

@Injectable()
export class BulkStructureService {
  constructor(
    @InjectRepository(Departamento)
    private readonly deptRepo: Repository<Departamento>,
    @InjectRepository(Area)
    private readonly areaRepo: Repository<Area>,
    @InjectRepository(Cargo)
    private readonly cargoRepo: Repository<Cargo>,
    private readonly logger: AppLogger,
  ) {}

  async importFromExcel(
    orgId: string,
    buffer: Buffer,
  ): Promise<BulkStructureResponseDto> {
    const rows = await this.parseExcel(buffer);

    if (rows.length === 0) {
      throw new BadRequestException(
        'El archivo Excel no contiene filas válidas. Asegúrese de diligenciar la hoja "Estructura" y no la hoja "Ejemplo".',
      );
    }
    if (rows.length > MAX_ROWS) {
      throw new BadRequestException(
        `El archivo excede el máximo de ${MAX_ROWS} filas`,
      );
    }

    const result: BulkStructureResponseDto = {
      totalRows: rows.length,
      departmentsCreated: 0,
      departmentsExisting: 0,
      areasCreated: 0,
      areasExisting: 0,
      positionsCreated: 0,
      positionsExisting: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < rows.length; i++) {
      const { department, descriptionDepartment, area, descriptionArea, position, descriptionPosition } = rows[i];
      const rowNum = i + 2; // Excel row (1-indexed + header)

      try {
        // 1. Upsert department
        const dept = await this.upsertDepartment(orgId, department, descriptionDepartment);
        if (dept.wasCreated) result.departmentsCreated++;
        else result.departmentsExisting++;

        // 2. Upsert area (if present)
        if (area) {
          const areaResult = await this.upsertArea(orgId, dept.id, area, descriptionArea);
          if (areaResult.wasCreated) result.areasCreated++;
          else result.areasExisting++;

          // 3. Upsert position (only if area is also present)
          if (position) {
            const posResult = await this.upsertPosition(
              orgId,
              dept.id,
              areaResult.id,
              position,
              descriptionPosition,
            );
            if (posResult.wasCreated) result.positionsCreated++;
            else result.positionsExisting++;
          }
        } else if (position) {
          // position without area → invalid
          result.failed++;
          result.errors.push({
            row: rowNum,
            department,
            area,
            position,
            reason: "El cargo requiere que se especifique un área",
          });
        }
      } catch (err: any) {
        result.failed++;
        result.errors.push({
          row: rowNum,
          department,
          area,
          position,
          reason: err?.message ?? "Error desconocido",
        });
        this.logger.warn(
          `Bulk import row ${rowNum} failed: ${err?.message}`,
          "BulkStructureService",
        );
      }
    }

    return result;
  }

  async resolveStructure(
    dto: ResolveStructureRequestDto,
  ): Promise<ResolveStructureResponseDto> {
    const resolved: ResolvedStructureItem[] = [];
    const unresolved: UnresolvedStructureItem[] = [];

    for (let i = 0; i < dto.items.length; i++) {
      const item = dto.items[i];
      const result = await this.resolveItem(dto.orgId, item, i);

      if ("reason" in result) {
        unresolved.push(result);
      } else {
        resolved.push(result);
      }
    }

    return { resolved, unresolved };
  }

  private async resolveItem(
    orgId: string,
    item: ResolveStructureItemDto,
    index: number,
  ): Promise<ResolvedStructureItem | UnresolvedStructureItem> {
    const dept = await this.deptRepo.findOne({
      where: { orgId, name: item.department },
    });
    if (!dept) {
      return {
        index,
        reason: `Departamento '${item.department}' no encontrado. Ejecute primero la carga de estructura organizacional.`,
      };
    }

    let areaId: string | null = null;
    if (item.area) {
      const area = await this.areaRepo.findOne({
        where: { orgId, departamentoId: dept.id, name: item.area },
      });
      if (!area) {
        return {
          index,
          reason: `Área '${item.area}' no encontrada en departamento '${item.department}'. Ejecute primero la carga de estructura organizacional.`,
        };
      }
      areaId = area.id;

      if (item.position) {
        const cargo = await this.cargoRepo.findOne({
          where: { orgId, areaId: area.id, name: item.position },
        });
        if (!cargo) {
          return {
            index,
            reason: `Cargo '${item.position}' no encontrado en área '${item.area}'. Ejecute primero la carga de estructura organizacional.`,
          };
        }
        return {
          index,
          departamentoId: dept.id,
          areaId: area.id,
          cargoId: cargo.id,
        };
      }
    }

    return { index, departamentoId: dept.id, areaId, cargoId: null };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async upsertDepartment(
    orgId: string,
    name: string,
    description?: string,
  ): Promise<Departamento & { wasCreated: boolean }> {
    const normalizedName = name.trim();
    const existing = await this.deptRepo.findOne({
      where: { orgId, name: normalizedName },
    });
    if (existing) return Object.assign(existing, { wasCreated: false });

    const created = await this.deptRepo.save(
      this.deptRepo.create({ orgId, name: normalizedName, description: description ?? null }),
    );
    return Object.assign(created, { wasCreated: true });
  }

  private async upsertArea(
    orgId: string,
    departamentoId: string,
    name: string,
    description?: string,
  ): Promise<Area & { wasCreated: boolean }> {
    const normalizedName = name.trim();
    const existing = await this.areaRepo.findOne({
      where: { orgId, departamentoId, name: normalizedName },
    });
    if (existing) return Object.assign(existing, { wasCreated: false });

    const created = await this.areaRepo.save(
      this.areaRepo.create({
        orgId,
        departamentoId,
        name: normalizedName,
        description: description ?? null,
      }),
    );
    return Object.assign(created, { wasCreated: true });
  }

  private async upsertPosition(
    orgId: string,
    departamentoId: string,
    areaId: string,
    name: string,
    description?: string,
  ): Promise<Cargo & { wasCreated: boolean }> {
    const normalizedName = name.trim();
    const existing = await this.cargoRepo.findOne({
      where: { orgId, areaId, name: normalizedName },
    });
    if (existing) return Object.assign(existing, { wasCreated: false });

    const created = await this.cargoRepo.save(
      this.cargoRepo.create({
        orgId,
        areaId,
        departamentoId,
        name: normalizedName,
        description: description ?? null,
      }),
    );
    return Object.assign(created, { wasCreated: true });
  }

  private async parseExcel(
    buffer: Buffer,
  ): Promise<
    Array<{
      department: string;
      descriptionDepartment?: string;
      area?: string;
      descriptionArea?: string;
      position?: string;
      descriptionPosition?: string;
    }>
  > {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const worksheet = workbook.getWorksheet('Estructura') ?? workbook.worksheets[0];
    if (!worksheet)
      throw new BadRequestException(
        "El archivo Excel no tiene hojas de cálculo",
      );

    const rows: Array<{
      department: string;
      descriptionDepartment?: string;
      area?: string;
      descriptionArea?: string;
      position?: string;
      descriptionPosition?: string;
    }> = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // skip header

      const department            = this.cellValue(row.getCell(1));
      const descriptionDepartment = this.cellValue(row.getCell(2));
      const area                  = this.cellValue(row.getCell(3));
      const descriptionArea       = this.cellValue(row.getCell(4));
      const position              = this.cellValue(row.getCell(5));
      const descriptionPosition   = this.cellValue(row.getCell(6));

      if (!department) return; // skip empty rows

      rows.push({
        department,
        ...(descriptionDepartment ? { descriptionDepartment } : {}),
        ...(area                  ? { area }                  : {}),
        ...(descriptionArea       ? { descriptionArea }       : {}),
        ...(position              ? { position }              : {}),
        ...(descriptionPosition   ? { descriptionPosition }   : {}),
      });
    });

    return rows;
  }

  private cellValue(cell: ExcelJS.Cell): string | undefined {
    const raw = cell.value;
    if (raw === null || raw === undefined) return undefined;
    const str = String(raw).trim();
    return str.length > 0 ? str : undefined;
  }
}

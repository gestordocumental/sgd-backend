import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditQueryDto, AuditExportDto } from './dto/audit-query.dto';
import { JwtPayload } from '@sgd/common';

const mockService: jest.Mocked<Pick<AuditService, 'query' | 'export' | 'findById'>> = {
  query:    jest.fn(),
  export:   jest.fn(),
  findById: jest.fn(),
};

function makePayload(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return { sub: 'user-1', companyId: 'org-1', isSuperAdmin: false, ...overrides };
}

describe('AuditController', () => {
  let controller: AuditController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuditController(mockService as unknown as AuditService);
  });

  describe('getLogs', () => {
    it('super admin can query without restrictions', async () => {
      const dto: AuditQueryDto = {};
      const me = makePayload({ isSuperAdmin: true });
      mockService.query.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
      await controller.getLogs(dto, me);
      expect(mockService.query).toHaveBeenCalledWith(dto, true);
    });

    it('normal user without companyId throws ForbiddenException', async () => {
      const dto: AuditQueryDto = {};
      const me = makePayload({ companyId: undefined });
      await expect(controller.getLogs(dto, me)).rejects.toThrow(ForbiddenException);
    });

    it('normal user cannot query a different org', async () => {
      const dto: AuditQueryDto = { orgId: 'other-org' };
      const me = makePayload({ companyId: 'my-org' });
      await expect(controller.getLogs(dto, me)).rejects.toThrow(ForbiddenException);
    });

    it('normal user query is scoped to their companyId', async () => {
      const dto: AuditQueryDto = {};
      const me = makePayload({ companyId: 'my-org' });
      mockService.query.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
      await controller.getLogs(dto, me);
      expect(dto.orgId).toBe('my-org');
      expect(mockService.query).toHaveBeenCalledWith(dto, false);
    });

    it('normal user can pass their own orgId', async () => {
      const dto: AuditQueryDto = { orgId: 'my-org' };
      const me = makePayload({ companyId: 'my-org' });
      mockService.query.mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 });
      await controller.getLogs(dto, me);
      expect(mockService.query).toHaveBeenCalled();
    });
  });

  describe('exportLogs', () => {
    it('super admin can export without restrictions', async () => {
      const dto: AuditExportDto = {};
      const me = makePayload({ isSuperAdmin: true });
      mockService.export.mockResolvedValue([]);
      await controller.exportLogs(dto, me);
      expect(mockService.export).toHaveBeenCalledWith(dto, true);
    });

    it('normal user without companyId throws ForbiddenException', async () => {
      const dto: AuditExportDto = {};
      const me = makePayload({ companyId: undefined });
      await expect(controller.exportLogs(dto, me)).rejects.toThrow(ForbiddenException);
    });

    it('normal user cannot export from a different org', async () => {
      const dto: AuditExportDto = { orgId: 'other-org' };
      const me = makePayload({ companyId: 'my-org' });
      await expect(controller.exportLogs(dto, me)).rejects.toThrow(ForbiddenException);
    });

    it('normal user export is scoped to their companyId', async () => {
      const dto: AuditExportDto = {};
      const me = makePayload({ companyId: 'my-org' });
      mockService.export.mockResolvedValue([]);
      await controller.exportLogs(dto, me);
      expect(dto.orgId).toBe('my-org');
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when document does not exist', async () => {
      mockService.findById.mockResolvedValue(null);
      const me = makePayload({ isSuperAdmin: true });
      await expect(controller.getById('missing-id', me)).rejects.toThrow(NotFoundException);
    });

    it('super admin can access events without orgId', async () => {
      const doc = { id: 'doc-1', orgId: null } as any;
      mockService.findById.mockResolvedValue(doc);
      const me = makePayload({ isSuperAdmin: true });
      const result = await controller.getById('doc-1', me);
      expect(result).toBe(doc);
    });

    it('super admin cannot access org-scoped events', async () => {
      const doc = { id: 'doc-1', orgId: 'other-org' } as any;
      mockService.findById.mockResolvedValue(doc);
      const me = makePayload({ isSuperAdmin: true });
      await expect(controller.getById('doc-1', me)).rejects.toThrow(ForbiddenException);
    });

    it('normal user without companyId throws ForbiddenException', async () => {
      const doc = { id: 'doc-1', orgId: 'my-org' } as any;
      mockService.findById.mockResolvedValue(doc);
      const me = makePayload({ companyId: undefined });
      await expect(controller.getById('doc-1', me)).rejects.toThrow(ForbiddenException);
    });

    it('normal user can access document from their org', async () => {
      const doc = { id: 'doc-1', orgId: 'my-org' } as any;
      mockService.findById.mockResolvedValue(doc);
      const me = makePayload({ companyId: 'my-org' });
      const result = await controller.getById('doc-1', me);
      expect(result).toBe(doc);
    });

    it('normal user cannot access document from different org', async () => {
      const doc = { id: 'doc-1', orgId: 'other-org' } as any;
      mockService.findById.mockResolvedValue(doc);
      const me = makePayload({ companyId: 'my-org' });
      await expect(controller.getById('doc-1', me)).rejects.toThrow(ForbiddenException);
    });
  });
});

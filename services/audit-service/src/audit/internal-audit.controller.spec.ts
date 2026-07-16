import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { InternalGuard } from '@sgd/common';
import { InternalAuditController } from './internal-audit.controller';
import { AuditService } from './audit.service';

describe('InternalAuditController', () => {
  let controller: InternalAuditController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = { export: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InternalAuditController],
      providers: [{ provide: AuditService, useValue: service }],
    })
      .overrideGuard(InternalGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(InternalAuditController);
  });

  describe('getLogsByCorrelation()', () => {
    it('exports logs scoped to the given correlationId + orgId, with no permission check involved', async () => {
      const logs = [{ id: 'log-1' }];
      service.export.mockResolvedValue(logs);

      const result = await controller.getLogsByCorrelation({
        correlationId: 'wf-1',
        orgId: 'org-1',
      });

      // superAdminScope must stay false — this endpoint has no notion of an
      // authenticated user, so it must never widen the query beyond orgId.
      expect(service.export).toHaveBeenCalledWith(
        { correlationId: 'wf-1', orgId: 'org-1' },
        false,
      );
      expect(result).toBe(logs);
    });

    it('rejects a request with no correlationId', async () => {
      await expect(controller.getLogsByCorrelation({ orgId: 'org-1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(service.export).not.toHaveBeenCalled();
    });

    it('rejects a request with no orgId', async () => {
      await expect(controller.getLogsByCorrelation({ correlationId: 'wf-1' })).rejects.toThrow(
        BadRequestException,
      );
      expect(service.export).not.toHaveBeenCalled();
    });
  });
});

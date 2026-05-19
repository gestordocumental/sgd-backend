import { InternalServerErrorException } from '@nestjs/common';
import { AdminTypologiesController } from './admin-typologies.controller';
import { TypologiesService } from './typologies.service';

describe('AdminTypologiesController', () => {
  let controller: AdminTypologiesController;
  let service:    jest.Mocked<Pick<TypologiesService, 'getStoragePerOrg'>>;

  beforeEach(() => {
    service    = { getStoragePerOrg: jest.fn().mockResolvedValue([]) };
    controller = new AdminTypologiesController(service as unknown as TypologiesService);
  });

  it('delegates to service.getStoragePerOrg and returns the result', async () => {
    const data = [{ orgId: 'org-1', storageTotalBytes: 1024, uploadedDocuments: 3 }];
    service.getStoragePerOrg.mockResolvedValue(data as any);
    const result = await controller.getStoragePerOrg();
    expect(service.getStoragePerOrg).toHaveBeenCalledTimes(1);
    expect(result).toBe(data);
  });

  it('returns an empty array when no orgs have storage data', async () => {
    service.getStoragePerOrg.mockResolvedValue([]);
    const result = await controller.getStoragePerOrg();
    expect(result).toEqual([]);
  });

  it('returns the expected fields for each entry', async () => {
    const data = [{ orgId: 'org-2', storageTotalBytes: 2048, uploadedDocuments: 7 }];
    service.getStoragePerOrg.mockResolvedValue(data as any);
    const [entry] = await controller.getStoragePerOrg() as typeof data;
    expect(entry.orgId).toBe('org-2');
    expect(entry.storageTotalBytes).toBe(2048);
    expect(entry.uploadedDocuments).toBe(7);
  });

  it('propagates errors thrown by service.getStoragePerOrg', async () => {
    service.getStoragePerOrg.mockRejectedValue(new InternalServerErrorException('DB error'));
    await expect(controller.getStoragePerOrg()).rejects.toThrow(InternalServerErrorException);
  });
});

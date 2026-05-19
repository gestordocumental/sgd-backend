import { AdminTypologiesController } from './admin-typologies.controller';
import { TypologiesService } from './typologies.service';

describe('AdminTypologiesController', () => {
  let controller: AdminTypologiesController;
  let service:    jest.Mocked<Pick<TypologiesService, 'getStoragePerOrg'>>;

  beforeEach(() => {
    service    = { getStoragePerOrg: jest.fn().mockResolvedValue([]) };
    controller = new AdminTypologiesController(service as unknown as TypologiesService);
  });

  it('delegates to service.getStoragePerOrg', async () => {
    const data = [{ orgId: 'org-1', storageTotalBytes: 1024, uploadedDocuments: 3 }];
    service.getStoragePerOrg.mockResolvedValue(data as any);
    const result = await controller.getStoragePerOrg();
    expect(service.getStoragePerOrg).toHaveBeenCalledTimes(1);
    expect(result).toBe(data);
  });
});

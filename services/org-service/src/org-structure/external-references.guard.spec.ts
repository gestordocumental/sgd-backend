import { ConflictException } from '@nestjs/common';
import { ExternalReferencesGuard } from './external-references.guard';
import { DocumentClientService } from '../common/document-client/document-client.service';
import { UserClientService } from '../common/user-client/user-client.service';

describe('ExternalReferencesGuard', () => {
  let documentClient: { countOrgStructureReferences: jest.Mock };
  let userClient: { countOrgStructureReferences: jest.Mock };
  let guard: ExternalReferencesGuard;

  beforeEach(() => {
    documentClient = { countOrgStructureReferences: jest.fn().mockResolvedValue(0) };
    userClient = { countOrgStructureReferences: jest.fn().mockResolvedValue(0) };
    guard = new ExternalReferencesGuard(
      documentClient as unknown as DocumentClientService,
      userClient as unknown as UserClientService,
    );
  });

  it('resolves without throwing when neither client reports any reference', async () => {
    await expect(
      guard.assertNone({
        orgId: 'org-1',
        filter: { departamentoId: 'dep-1' },
        resourceLabel: 'departamento "Finanzas"',
        resourceId: 'dep-1',
        errorCode: 'DEPARTMENT_HAS_EXTERNAL_REFERENCES',
      }),
    ).resolves.toBeUndefined();

    expect(documentClient.countOrgStructureReferences).toHaveBeenCalledWith('org-1', { departamentoId: 'dep-1' });
    expect(userClient.countOrgStructureReferences).toHaveBeenCalledWith('org-1', { departamentoId: 'dep-1' });
  });

  it('throws a ConflictException with the given errorCode and both counts when document-service reports references', async () => {
    documentClient.countOrgStructureReferences.mockResolvedValue(2);

    await expect(
      guard.assertNone({
        orgId: 'org-1',
        filter: { areaId: 'area-1' },
        resourceLabel: 'area "Pagos"',
        resourceId: 'area-1',
        errorCode: 'AREA_HAS_EXTERNAL_REFERENCES',
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'Cannot delete area "Pagos": it is still referenced by 2 typology(ies) and 0 user(s)',
        errorCode: 'AREA_HAS_EXTERNAL_REFERENCES',
        params: { id: 'area-1', typologiesCount: 2, usersCount: 0 },
      },
    });
  });

  it('throws when only user-service reports references', async () => {
    userClient.countOrgStructureReferences.mockResolvedValue(1);

    await expect(
      guard.assertNone({
        orgId: 'org-1',
        filter: { cargoId: 'cargo-1' },
        resourceLabel: 'cargo "Analista"',
        resourceId: 'cargo-1',
        errorCode: 'CARGO_HAS_EXTERNAL_REFERENCES',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not swallow a failure from either client — fails closed', async () => {
    documentClient.countOrgStructureReferences.mockRejectedValue(new Error('document-service unreachable'));

    await expect(
      guard.assertNone({
        orgId: 'org-1',
        filter: { departamentoId: 'dep-1' },
        resourceLabel: 'departamento "Finanzas"',
        resourceId: 'dep-1',
        errorCode: 'DEPARTMENT_HAS_EXTERNAL_REFERENCES',
      }),
    ).rejects.toThrow('document-service unreachable');
  });
});

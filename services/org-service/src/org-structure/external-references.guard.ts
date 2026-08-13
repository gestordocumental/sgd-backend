import { Injectable, ConflictException } from '@nestjs/common';
import { DocumentClientService } from '../common/document-client/document-client.service';
import { UserClientService } from '../common/user-client/user-client.service';

/** Which single org-structure level is being checked — mirrors DocumentClientService/UserClientService's filter shape. */
export type ExternalReferenceFilter =
  | { departamentoId: string }
  | { areaId: string }
  | { cargoId: string };

/**
 * Blocks deleting a departamento/area/cargo while a typology or user still
 * references it directly — otherwise their record is left pointing at an id
 * that no longer exists. Was previously copy-pasted identically into
 * Departamentos/Areas/CargosService.remove() (one instance per level, same
 * two calls + count check + ConflictException shape each time) — centralized
 * here so the fail-closed policy below and the "typology(ies)/user(s)"
 * message shape can't drift between the three call sites.
 *
 * Callers must run this BEFORE opening their own delete transaction: holding
 * a pessimistic_write lock across two outbound HTTP calls (~5s timeout
 * ceiling each) would turn a document-service/user-service slowdown into a
 * long-held lock on a hot row.
 *
 * Deliberately NOT wrapped in try/catch: a failure here (timeout, open
 * circuit, 5xx) must fail the delete too (fail-closed), not silently let it
 * through. DocumentClientService/UserClientService already translate every
 * failure mode into a propagatable Nest exception.
 */
@Injectable()
export class ExternalReferencesGuard {
  constructor(
    private readonly documentClient: DocumentClientService,
    private readonly userClient: UserClientService,
  ) {}

  async assertNone(params: {
    orgId: string;
    filter: ExternalReferenceFilter;
    resourceLabel: string;
    resourceId: string;
    errorCode: 'DEPARTMENT_HAS_EXTERNAL_REFERENCES' | 'AREA_HAS_EXTERNAL_REFERENCES' | 'CARGO_HAS_EXTERNAL_REFERENCES';
  }): Promise<void> {
    const { orgId, filter, resourceLabel, resourceId, errorCode } = params;
    const [typologiesCount, usersCount] = await Promise.all([
      this.documentClient.countOrgStructureReferences(orgId, filter),
      this.userClient.countOrgStructureReferences(orgId, filter),
    ]);
    if (typologiesCount > 0 || usersCount > 0) {
      throw new ConflictException({
        message: `Cannot delete ${resourceLabel}: it is still referenced by ${typologiesCount} typology(ies) and ${usersCount} user(s)`,
        errorCode,
        params: { id: resourceId, typologiesCount, usersCount },
      });
    }
  }
}

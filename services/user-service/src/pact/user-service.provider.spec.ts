import * as path from 'path';
import { Test } from '@nestjs/testing';
import { INestApplication, CanActivate, NotFoundException, Controller, Post, Body } from '@nestjs/common';
import { Verifier } from '@pact-foundation/pact';
import { ConfigService } from '@nestjs/config';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { StorageService } from '../common/storage/storage.service';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { User, RegistrationStatus } from '../users/entities/user.entity';

const PACT_TOKEN = 'pact-test-token';
const USER_ID    = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ORG_ID     = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22';

// Typed against the real entity — TypeScript will fail here if User adds/removes
// required fields, keeping the mock in sync with the actual response shape.
const mockUser: User = {
  id:                 USER_ID,
  email:              'user@example.com',
  firstName:          'Test',
  lastName:           'User',
  position:           null,
  idNumber:           null,
  departamentoId:     null,
  areaId:             null,
  cargoId:            null,
  registrationStatus: RegistrationStatus.ACTIVE,
  isActive:           true,
  isSuperAdmin:       false,
  avatarUrl:          null,
  orgRoles:           [],
  createdAt:          new Date('2024-01-01T00:00:00Z'),
  updatedAt:          new Date('2024-01-01T00:00:00Z'),
  deletedAt:          null,
};

// Bypass JWT / permissions check — the pact only tests API shape, not auth
const allowAll: CanActivate = { canActivate: () => true };

// Mutable so the PactStateController can flip behaviour between interactions
const configGet = jest.fn().mockReturnValue(PACT_TOKEN);
const configMock = { get: configGet, getOrThrow: configGet };

const svcFindOne                 = jest.fn().mockResolvedValue(mockUser);
const svcGetCompanies            = jest.fn().mockResolvedValue([ORG_ID]);
const svcGetEffectivePermissions = jest.fn().mockResolvedValue([{ module: 'documents', action: 'read' }]);

const mockUsersService: Partial<UsersService> = {
  findOne:                 svcFindOne,
  getCompanies:            svcGetCompanies,
  getEffectivePermissions: svcGetEffectivePermissions,
};

// The Pact Rust core calls POST /_pactSetup before each interaction to set up provider state.
// This lightweight controller receives those calls and configures the mocks accordingly.
@Controller('_pactSetup')
class PactStateController {
  @Post()
  setupState(@Body() body: { state?: string; action?: string }): void {
    if (body.action === 'teardown') {
      configGet.mockReturnValue(PACT_TOKEN);
      svcFindOne.mockResolvedValue(mockUser);
      svcGetCompanies.mockResolvedValue([ORG_ID]);
      svcGetEffectivePermissions.mockResolvedValue([{ module: 'documents', action: 'read' }]);
      return;
    }

    switch (body.state) {
      case 'user does not exist': {
        configGet.mockReturnValue(PACT_TOKEN);
        const notFound = new NotFoundException(`User ${USER_ID} not found`);
        svcFindOne.mockRejectedValue(notFound);
        svcGetCompanies.mockRejectedValue(notFound);
        svcGetEffectivePermissions.mockRejectedValue(notFound);
        break;
      }
      case 'internal token is invalid':
        // Return a different token so verifyInternalToken() throws UnauthorizedException
        configGet.mockReturnValue('wrong-token');
        svcFindOne.mockResolvedValue(mockUser);
        break;
      default:
        configGet.mockReturnValue(PACT_TOKEN);
        svcFindOne.mockResolvedValue(mockUser);
        svcGetCompanies.mockResolvedValue([ORG_ID]);
        svcGetEffectivePermissions.mockResolvedValue([{ module: 'documents', action: 'read' }]);
    }
  }
}

describe('user-service provider — satisfies auth-service consumer expectations', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The Pact Rust FFI (reqwest) attempts IPv6 (::1) first when resolving "localhost".
    // When the server binds to IPv4 only, the IPv6 connection attempt times out
    // after ~20 s before falling back to 127.0.0.1. Using the literal IPv4 address
    // for both binding and connection eliminates this delay entirely.
    process.env['NO_PROXY']   = '127.0.0.1,localhost';
    process.env['no_proxy']   = '127.0.0.1,localhost';
    process.env['PACT_DO_NOT_TRACK'] = 'true';

    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController, PactStateController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: StorageService, useValue: {} },
        { provide: ConfigService, useValue: configMock },
      ],
    })
      .overrideGuard(PermissionsGuard)
      .useValue(allowAll)
      .compile();

    app = moduleRef.createNestApplication();
    // Bind to the IPv4 loopback explicitly so the server is never reachable
    // on ::1, which prevents the Pact Rust FFI from making a 20-second
    // IPv6-connect-timeout attempt before each request.
    await app.listen(0, '127.0.0.1');
  });

  afterAll(() => app.close());

  it('satisfies all interactions recorded in the auth-service consumer pact', async () => {
    const port = (app.getHttpServer().address() as { port: number }).port;

    // PACT_DIR puede sobreescribirse por variable de entorno para desacoplar la ruta
    // del layout del monorepo (útil en brokers o estructuras de directorio distintas).
    // Fallback: ruta relativa estándar dentro del monorepo (services/* como hermanos).
    const pactDir = process.env.PACT_DIR
      ? path.resolve(process.env.PACT_DIR)
      : path.resolve(__dirname, '../../../auth-service/pacts');

    const pactFile = path.resolve(pactDir, 'auth-service-user-service.json');

    // Use the literal IPv4 address to avoid DNS round-trips that resolve
    // "localhost" to ::1 and trigger the 20-second IPv6 fallback in the
    // Pact Rust FFI HTTP client.
    return new Verifier({
      provider:               'user-service',
      providerBaseUrl:        `http://127.0.0.1:${port}`,
      pactUrls:               [pactFile],
      providerStatesSetupUrl: `http://127.0.0.1:${port}/_pactSetup`,
    }).verifyProvider();
  }, 120_000);
});

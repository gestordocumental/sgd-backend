import * as path from 'path';
import { Test } from '@nestjs/testing';
import { INestApplication, CanActivate } from '@nestjs/common';
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

const mockUsersService: Partial<UsersService> = {
  getCompanies:            jest.fn().mockResolvedValue([ORG_ID]),
  getEffectivePermissions: jest.fn().mockResolvedValue([{ module: 'documents', action: 'read' }]),
  findOne:                 jest.fn().mockResolvedValue(mockUser),
};

describe('user-service provider — satisfies auth-service consumer expectations', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: StorageService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            // verifyInternalToken() calls configService.get(key)
            get: () => PACT_TOKEN,
            getOrThrow: () => PACT_TOKEN,
          },
        },
      ],
    })
      .overrideGuard(PermissionsGuard)
      .useValue(allowAll)
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
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

    return new Verifier({
      provider: 'user-service',
      providerBaseUrl: `http://localhost:${port}`,
      pactUrls: [pactFile],
    }).verifyProvider();
  });
});

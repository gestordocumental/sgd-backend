import * as path from 'path';
import { Test } from '@nestjs/testing';
import { INestApplication, CanActivate } from '@nestjs/common';
import { Verifier } from '@pact-foundation/pact';
import { ConfigService } from '@nestjs/config';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { StorageService } from '../common/storage/storage.service';
import { PermissionsGuard } from '../common/guards/permissions.guard';

const PACT_TOKEN = 'pact-test-token';
const USER_ID    = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ORG_ID     = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22';

// Bypass JWT / permissions check — the pact only tests API shape, not auth
const allowAll: CanActivate = { canActivate: () => true };

const mockUsersService: Partial<UsersService> = {
  getCompanies: jest.fn().mockResolvedValue([ORG_ID]),
  getEffectivePermissions: jest.fn().mockResolvedValue([
    { module: 'documents', action: 'read' },
  ]),
  findOne: jest.fn().mockResolvedValue({
    id: USER_ID,
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    position: null,
    idNumber: null,
    departamentoId: null,
    areaId: null,
    cargoId: null,
    registrationStatus: 'active',
    isActive: true,
    isSuperAdmin: false,
    avatarUrl: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    deletedAt: null,
  }),
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
    const pactFile = path.resolve(
      __dirname,
      '../../../auth-service/pacts/auth-service-user-service.json',
    );

    return new Verifier({
      provider: 'user-service',
      providerBaseUrl: `http://localhost:${port}`,
      pactUrls: [pactFile],
    }).verifyProvider();
  });
});

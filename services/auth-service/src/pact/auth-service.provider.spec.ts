import * as path from 'path';
import { Test } from '@nestjs/testing';
import { INestApplication, CanActivate } from '@nestjs/common';
import { Verifier } from '@pact-foundation/pact';
import { ConfigService } from '@nestjs/config';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { InternalGuard } from '@sgd/common';

// Bypass internal-token guard — pact verifies API shape, not auth
const allowAll: CanActivate = { canActivate: () => true };

const mockAuthService = {
  provisionCredentials: jest.fn().mockResolvedValue({ ok: true }),
  disableCredential: jest.fn().mockResolvedValue(undefined),
  enableCredential: jest.fn().mockResolvedValue(undefined),
  revokeAllRefreshTokens: jest.fn().mockResolvedValue(undefined),
};

describe('auth-service provider — satisfies user-service consumer expectations', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'NODE_ENV' ? 'test' : undefined),
            getOrThrow: () => { throw new Error('getOrThrow not expected in provider tests'); },
          },
        },
      ],
    })
      .overrideGuard(InternalGuard)
      .useValue(allowAll)
      .compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);
  });

  afterAll(() => app.close());

  it('satisfies all interactions recorded in the user-service consumer pact', async () => {
    const port = (app.getHttpServer().address() as { port: number }).port;
    const pactFile = path.resolve(
      __dirname,
      '../../../user-service/pacts/user-service-auth-service.json',
    );

    return new Verifier({
      provider: 'auth-service',
      providerBaseUrl: `http://localhost:${port}`,
      pactUrls: [pactFile],
    }).verifyProvider();
  });
});

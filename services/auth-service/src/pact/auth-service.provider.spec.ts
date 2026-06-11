import * as path from 'path';
import {
  Controller,
  Post,
  Body,
  ConflictException,
  NotFoundException,
  BadRequestException,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Verifier } from '@pact-foundation/pact';
import { ConfigService } from '@nestjs/config';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { InternalGuard } from '@sgd/common';

const PACT_TOKEN = 'pact-test-token';

const configGet = jest.fn();

const mockAuthService = {
  provisionCredentials: jest.fn(),
  disableCredential: jest.fn(),
  enableCredential: jest.fn(),
  revokeAllRefreshTokens: jest.fn(),
};

function resetMocks(): void {
  configGet.mockImplementation((key: string) => {
    if (key === 'INTERNAL_TOKEN_USER_AUTH') return PACT_TOKEN;
    return undefined;
  });
  mockAuthService.provisionCredentials.mockResolvedValue({ ok: true });
  mockAuthService.disableCredential.mockResolvedValue(undefined);
  mockAuthService.enableCredential.mockResolvedValue(undefined);
  mockAuthService.revokeAllRefreshTokens.mockResolvedValue(undefined);
}

resetMocks();

// The Pact Rust core calls POST /_pactSetup before each interaction to set up provider state.
// This lightweight controller receives those calls and configures the mocks accordingly.
@Controller('_pactSetup')
class PactStateController {
  @Post()
  setupState(@Body() body: { state?: string; action?: string }): void {
    if (body.action === 'teardown') {
      resetMocks();
      return;
    }

    resetMocks();

    switch (body.state) {
      case 'credentials already exist for the user':
        mockAuthService.provisionCredentials.mockRejectedValue(
          new ConflictException('Email already registered for another account'),
        );
        break;
      case 'credentials do not exist for the user':
        mockAuthService.disableCredential.mockRejectedValue(
          new NotFoundException('Credentials not found'),
        );
        break;
      case 'email is invalid':
        mockAuthService.provisionCredentials.mockRejectedValue(
          new BadRequestException('Validation failed'),
        );
        break;
      case 'internal token is invalid':
        // InternalGuard compares x-internal-token header against the config value.
        // Returning a different value causes timingSafeEqual to fail → 401.
        configGet.mockImplementation((key: string) => {
          if (key === 'INTERNAL_TOKEN_USER_AUTH') return 'wrong-token';
          return undefined;
        });
        break;
      // 'credentials exist for the user': disable/enable/revoke return void → 204
      // 'no credentials exist for the user': provision returns { ok: true } → 201
    }
  }
}

describe('auth-service provider — satisfies user-service consumer expectations', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // The Pact Rust FFI (reqwest) attempts IPv6 (::1) first when resolving "localhost".
    // When the server binds to IPv4 only, the IPv6 connection attempt times out
    // after ~20 s before falling back to 127.0.0.1. Using the literal IPv4 address
    // for both binding and connection eliminates this delay entirely.
    process.env['NO_PROXY']          = '127.0.0.1,localhost';
    process.env['no_proxy']          = '127.0.0.1,localhost';
    process.env['PACT_DO_NOT_TRACK'] = 'true';

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController, PactStateController],
      providers: [
        { provide: AuthService,    useValue: mockAuthService },
        {
          provide: ConfigService,
          useValue: {
            get:      configGet,
            getOrThrow: (key: string) => {
              const val = configGet(key);
              if (val === undefined) throw new Error(`Config key not found: ${key}`);
              return val;
            },
          },
        },
        InternalGuard,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
  });

  afterAll(() => app.close());

  it('satisfies all interactions recorded in the user-service consumer pact', async () => {
    const port = (app.getHttpServer().address() as { port: number }).port;
    const pactFile = path.resolve(
      __dirname,
      '../../../user-service/pacts/user-service-auth-service.json',
    );

    return new Verifier({
      provider:               'auth-service',
      providerBaseUrl:        `http://127.0.0.1:${port}`,
      pactUrls:               [pactFile],
      providerStatesSetupUrl: `http://127.0.0.1:${port}/_pactSetup`,
    }).verifyProvider();
  }, 120_000);
});

import * as path from 'path';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { AuthClientService } from './auth-client.service';
import { AppLogger } from '@sgd/common';

const { like } = MatchersV3;

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const provider = new PactV3({
  consumer: 'user-service',
  provider: 'auth-service',
  dir: path.resolve(__dirname, '../../pacts'),
  logLevel: 'error',
});

async function createModule(baseUrl: string): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [HttpModule],
    providers: [
      AuthClientService,
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: (key: string) => {
            if (key === 'AUTH_SERVICE_URL') return baseUrl;
            if (key === 'INTERNAL_TOKEN_USER_AUTH') return 'pact-test-token';
            throw new Error(`Unexpected config key: ${key}`);
          },
        },
      },
      {
        provide: AppLogger,
        useValue: { http: jest.fn(), warn: jest.fn(), log: jest.fn(), error: jest.fn() },
      },
    ],
  }).compile();
}

describe('user-service → auth-service (consumer contract)', () => {
  it('POST /credentials/provision creates credentials', () =>
    provider
      .addInteraction({
        states: [{ description: 'no credentials exist for the user' }],
        uponReceiving: 'a request to provision credentials for a new user',
        withRequest: {
          method: 'POST',
          path: '/api/v1/auth/credentials/provision',
          headers: {
            'x-internal-token': like('pact-test-token'),
            'Content-Type': like('application/json'),
          },
          body: {
            userId: USER_ID,
            email: 'user@example.com',
            password: 'Secur3P@ss!',
          },
        },
        willRespondWith: {
          status: 201,
          body: like({ ok: true }),
        },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(AuthClientService);
        await expect(
          svc.provisionCredentials({ userId: USER_ID, email: 'user@example.com', password: 'Secur3P@ss!' }),
        ).resolves.toBeUndefined();
      }),
  );

  it('PATCH /credentials/:userId/disable disables credentials', () =>
    provider
      .addInteraction({
        states: [{ description: 'credentials exist for the user' }],
        uponReceiving: 'a request to disable user credentials',
        withRequest: {
          method: 'PATCH',
          path: `/api/v1/auth/credentials/${USER_ID}/disable`,
          headers: { 'x-internal-token': like('pact-test-token') },
        },
        willRespondWith: { status: 204 },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(AuthClientService);
        await expect(svc.disableCredentials(USER_ID)).resolves.toBeUndefined();
      }),
  );

  it('PATCH /credentials/:userId/enable enables credentials', () =>
    provider
      .addInteraction({
        states: [{ description: 'credentials exist for the user' }],
        uponReceiving: 'a request to enable user credentials',
        withRequest: {
          method: 'PATCH',
          path: `/api/v1/auth/credentials/${USER_ID}/enable`,
          headers: { 'x-internal-token': like('pact-test-token') },
        },
        willRespondWith: { status: 204 },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(AuthClientService);
        await expect(svc.enableCredentials(USER_ID)).resolves.toBeUndefined();
      }),
  );

  it('PATCH /credentials/:userId/revoke-tokens revokes all refresh tokens', () =>
    provider
      .addInteraction({
        states: [{ description: 'credentials exist for the user' }],
        uponReceiving: 'a request to revoke all refresh tokens for a user',
        withRequest: {
          method: 'PATCH',
          path: `/api/v1/auth/credentials/${USER_ID}/revoke-tokens`,
          headers: { 'x-internal-token': like('pact-test-token') },
        },
        willRespondWith: { status: 204 },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(AuthClientService);
        await expect(svc.revokeAllTokens(USER_ID)).resolves.toBeUndefined();
      }),
  );

  // ── Error cases ─────────────────────────────────────────────────────────────

  it('POST /credentials/provision returns 400 when payload is invalid → consumer re-throws HttpException(400)', () =>
    provider
      .addInteraction({
        states: [{ description: 'email is invalid' }],
        uponReceiving: 'a provision request with an invalid email',
        withRequest: {
          method: 'POST',
          path: '/api/v1/auth/credentials/provision',
          headers: {
            'x-internal-token': like('pact-test-token'),
            'Content-Type': like('application/json'),
          },
          body: {
            userId: USER_ID,
            email: 'not-an-email',
            password: 'Secur3P@ss!',
          },
        },
        willRespondWith: {
          status: 400,
          headers: { 'Content-Type': like('application/json') },
          body: like({ message: like('Validation failed') }),
        },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(AuthClientService);
        const err = await svc
          .provisionCredentials({ userId: USER_ID, email: 'not-an-email', password: 'Secur3P@ss!' })
          .catch((e) => e);
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(400);
      }),
  );

  it('POST /credentials/provision returns 409 when credentials already exist → consumer re-throws HttpException(409)', () =>
    provider
      .addInteraction({
        states: [{ description: 'credentials already exist for the user' }],
        uponReceiving: 'a provision request when credentials already exist',
        withRequest: {
          method: 'POST',
          path: '/api/v1/auth/credentials/provision',
          headers: {
            'x-internal-token': like('pact-test-token'),
            'Content-Type': like('application/json'),
          },
          body: {
            userId: USER_ID,
            email: 'user@example.com',
            password: 'Secur3P@ss!',
          },
        },
        willRespondWith: {
          status: 409,
          headers: { 'Content-Type': like('application/json') },
          body: like({ message: like('Conflict') }),
        },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(AuthClientService);
        const err = await svc
          .provisionCredentials({ userId: USER_ID, email: 'user@example.com', password: 'Secur3P@ss!' })
          .catch((e) => e);
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(409);
      }),
  );

  it('PATCH /credentials/:userId/disable returns 404 when credentials do not exist → consumer re-throws HttpException(404)', () =>
    provider
      .addInteraction({
        states: [{ description: 'credentials do not exist for the user' }],
        uponReceiving: 'a disable request for a user without credentials',
        withRequest: {
          method: 'PATCH',
          path: `/api/v1/auth/credentials/${USER_ID}/disable`,
          headers: { 'x-internal-token': like('pact-test-token') },
        },
        willRespondWith: {
          status: 404,
          headers: { 'Content-Type': like('application/json') },
          body: like({ message: like('Not Found') }),
        },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(AuthClientService);
        const err = await svc.disableCredentials(USER_ID).catch((e) => e);
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(404);
      }),
  );

  it('PATCH /credentials/:userId/enable returns 401 when internal token is invalid → consumer re-throws HttpException(401)', () =>
    provider
      .addInteraction({
        states: [{ description: 'internal token is invalid' }],
        uponReceiving: 'an enable request with an invalid internal token',
        withRequest: {
          method: 'PATCH',
          path: `/api/v1/auth/credentials/${USER_ID}/enable`,
          headers: { 'x-internal-token': like('pact-test-token') },
        },
        willRespondWith: {
          status: 401,
          headers: { 'Content-Type': like('application/json') },
          body: like({ message: like('Unauthorized') }),
        },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(AuthClientService);
        const err = await svc.enableCredentials(USER_ID).catch((e) => e);
        expect(err).toBeInstanceOf(HttpException);
        expect((err as HttpException).getStatus()).toBe(401);
      }),
  );
});

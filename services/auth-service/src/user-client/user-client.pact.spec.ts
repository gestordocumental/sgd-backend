import * as path from 'path';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { Test, TestingModule } from '@nestjs/testing';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { UserClientService } from './user-client.service';
import { AppLogger } from '@sgd/common';

const { like, eachLike } = MatchersV3;

const USER_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const ORG_ID  = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22';

const provider = new PactV3({
  consumer: 'auth-service',
  provider: 'user-service',
  dir: path.resolve(__dirname, '../../pacts'),
  logLevel: 'error',
});

async function createModule(baseUrl: string): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [HttpModule],
    providers: [
      UserClientService,
      {
        provide: ConfigService,
        useValue: {
          getOrThrow: (key: string) => {
            if (key === 'USER_SERVICE_URL') return baseUrl;
            if (key === 'INTERNAL_TOKEN_AUTH_USER') return 'pact-test-token';
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

describe('auth-service → user-service (consumer contract)', () => {
  it('GET /:id/companies returns an array of orgIds', () =>
    provider
      .addInteraction({
        states: [{ description: 'user exists and belongs to at least one org' }],
        uponReceiving: 'a request for the orgs a user belongs to',
        withRequest: {
          method: 'GET',
          path: `/api/v1/users/${USER_ID}/companies`,
          headers: { 'x-internal-token': like('pact-test-token') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': like('application/json') },
          body: eachLike(ORG_ID),
        },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(UserClientService);
        const result = await svc.getUserCompanies(USER_ID);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      }),
  );

  it('GET /:id/effective-permissions returns module+action pairs', () =>
    provider
      .addInteraction({
        states: [{ description: 'user has at least one permission in org' }],
        uponReceiving: 'a request for the effective permissions of a user in an org',
        withRequest: {
          method: 'GET',
          path: `/api/v1/users/${USER_ID}/effective-permissions`,
          query: { companyId: ORG_ID },
          headers: { 'x-internal-token': like('pact-test-token') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': like('application/json') },
          body: eachLike({
            module: like('documents'),
            action: like('read'),
          }),
        },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(UserClientService);
        const result = await svc.getUserEffectivePermissions(USER_ID, ORG_ID);
        expect(Array.isArray(result)).toBe(true);
        expect(result[0]).toMatchObject({ module: expect.any(String), action: expect.any(String) });
      }),
  );

  it('GET /:id returns the isSuperAdmin flag for a user', () =>
    provider
      .addInteraction({
        states: [{ description: 'user exists' }],
        uponReceiving: 'a request for user profile info',
        withRequest: {
          method: 'GET',
          path: `/api/v1/users/${USER_ID}`,
          headers: { 'x-internal-token': like('pact-test-token') },
        },
        willRespondWith: {
          status: 200,
          headers: { 'Content-Type': like('application/json') },
          body: like({
            id: like(USER_ID),
            email: like('user@example.com'),
            isSuperAdmin: like(false),
            isActive: like(true),
            registrationStatus: like('active'),
          }),
        },
      })
      .executeTest(async (mockServer) => {
        const module = await createModule(mockServer.url);
        const svc = module.get(UserClientService);
        const result = await svc.getUserInfo(USER_ID);
        expect(result).toHaveProperty('isSuperAdmin');
        expect(typeof result.isSuperAdmin).toBe('boolean');
      }),
  );

  // ── Error cases ─────────────────────────────────────────────────────────────

  it('GET /:id/companies returns 404 when user does not exist → consumer throws NotFoundException', () =>
    provider
      .addInteraction({
        states: [{ description: 'user does not exist' }],
        uponReceiving: 'a companies request for a non-existent user',
        withRequest: {
          method: 'GET',
          path: `/api/v1/users/${USER_ID}/companies`,
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
        const svc = module.get(UserClientService);
        await expect(svc.getUserCompanies(USER_ID)).rejects.toThrow(NotFoundException);
      }),
  );

  it('GET /:id/effective-permissions returns 404 when user does not exist → consumer throws NotFoundException', () =>
    provider
      .addInteraction({
        states: [{ description: 'user does not exist' }],
        uponReceiving: 'an effective-permissions request for a non-existent user',
        withRequest: {
          method: 'GET',
          path: `/api/v1/users/${USER_ID}/effective-permissions`,
          query: { companyId: ORG_ID },
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
        const svc = module.get(UserClientService);
        await expect(svc.getUserEffectivePermissions(USER_ID, ORG_ID)).rejects.toThrow(NotFoundException);
      }),
  );

  it('GET /:id returns 404 when user does not exist → consumer throws NotFoundException', () =>
    provider
      .addInteraction({
        states: [{ description: 'user does not exist' }],
        uponReceiving: 'a profile info request for a non-existent user',
        withRequest: {
          method: 'GET',
          path: `/api/v1/users/${USER_ID}`,
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
        const svc = module.get(UserClientService);
        await expect(svc.getUserInfo(USER_ID)).rejects.toThrow(NotFoundException);
      }),
  );

  it('GET /:id returns 401 when internal token is rejected → consumer throws InternalServerErrorException', () =>
    provider
      .addInteraction({
        states: [{ description: 'internal token is invalid' }],
        uponReceiving: 'a profile info request with an invalid internal token',
        withRequest: {
          method: 'GET',
          path: `/api/v1/users/${USER_ID}`,
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
        const svc = module.get(UserClientService);
        await expect(svc.getUserInfo(USER_ID)).rejects.toThrow(InternalServerErrorException);
      }),
  );
});

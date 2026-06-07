/**
 * auth.integration.spec.ts — Integration tests for AuthService
 *
 * Requires real PostgreSQL and Redis. Connection via environment variables:
 *   TEST_PG_HOST        (default: localhost)
 *   TEST_PG_PORT        (default: 5432)
 *   TEST_PG_USERNAME    (default: postgres)
 *   TEST_PG_PASSWORD    (default: postgres)
 *   TEST_PG_DATABASE    (default: auth_test)
 *   TEST_REDIS_HOST     (default: localhost)
 *   TEST_REDIS_PORT     (default: 6379)
 *
 * In CI: set by the GitHub Actions services: block in ci.yml (test-integration job).
 * Locally: start `docker compose up postgres redis` or pass env vars.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AuthService } from './auth.service';
import { JwtKeyService } from './jwt-key.service';
import { Credential } from './entities/credential.entity';
import { AppLogger, KafkaProducerService } from '@sgd/common';
import { UserClientService } from '../user-client/user-client.service';

// ── Connection helpers ────────────────────────────────────────────────────────

function pgConfig() {
  return {
    host:     process.env.TEST_PG_HOST     ?? 'localhost',
    port:     Number(process.env.TEST_PG_PORT     ?? 5432),
    username: process.env.TEST_PG_USERNAME ?? 'postgres',
    password: process.env.TEST_PG_PASSWORD ?? 'postgres',
    database: process.env.TEST_PG_DATABASE ?? 'auth_test',
  };
}

function redisConfig() {
  return {
    host: process.env.TEST_REDIS_HOST ?? 'localhost',
    port: Number(process.env.TEST_REDIS_PORT ?? 6379),
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

describe('AuthService — integration', () => {
  let module: TestingModule;
  let authService: AuthService;
  let dataSource: DataSource;
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(redisConfig());

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          ...pgConfig(),
          entities: [Credential],
          // Drop and re-create schema on each run for isolation.
          // Migration correctness is verified separately by migration:run in CI.
          synchronize: true,
          dropSchema: true,
        }),
        TypeOrmModule.forFeature([Credential]),
        JwtModule.register({}),
      ],
      providers: [
        AuthService,
        JwtKeyService,
        {
          provide: 'REDIS_CLIENT',
          useValue: redis,
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              ({
                JWT_SECRET:            'integration-test-secret',
                JWT_REFRESH_SECRET:    'integration-test-refresh-secret',
                JWT_EXPIRATION:        '15m',
                JWT_REFRESH_EXPIRATION:'12h',
                BCRYPT_ROUNDS:         '10',
              }[key] ?? null),
            getOrThrow: (key: string) => {
              const map: Record<string, string> = {
                JWT_SECRET:            'integration-test-secret',
                JWT_REFRESH_SECRET:    'integration-test-refresh-secret',
                JWT_EXPIRATION:        '15m',
                JWT_REFRESH_EXPIRATION:'12h',
                BCRYPT_ROUNDS:         '10',
              };
              if (!(key in map)) throw new Error(`Config key not found in integration test: ${key}`);
              return map[key];
            },
          },
        },
        // UserClientService is HTTP-only; mock it with realistic responses
        {
          provide: UserClientService,
          useValue: {
            getUserInfo:                jest.fn().mockResolvedValue({ isSuperAdmin: false }),
            getUserCompanies:           jest.fn().mockResolvedValue(['org-test-1']),
            getUserEffectivePermissions:jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: KafkaProducerService,
          useValue: { emitSafe: jest.fn() },
        },
        {
          provide: AppLogger,
          useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
        },
      ],
    }).compile();

    authService = module.get(AuthService);
    dataSource  = module.get(DataSource);
  });

  afterAll(async () => {
    await module.close();
    await redis.quit();
  });

  beforeEach(async () => {
    // Clear Redis and DB between tests for isolation
    await redis.flushdb();
    await dataSource.getRepository(Credential).clear();
  });

  // ── provisionCredentials ──────────────────────────────────────────────────

  describe('provisionCredentials()', () => {
    it('persists a bcrypt-hashed credential to PostgreSQL', async () => {
      const userId = randomUUID();
      const email  = `user+${userId}@integration.test`;

      await authService.provisionCredentials({ userId, email, password: 'TestPass123!' });

      const repo  = dataSource.getRepository(Credential);
      const saved = await repo.findOneOrFail({ where: { userId } });
      expect(saved.email).toBe(email);
      expect(saved.passwordHash).toMatch(/^\$2/); // bcrypt hash prefix
    });

    it('is idempotent — calling twice for the same userId returns ok both times', async () => {
      const userId = randomUUID();
      const email  = `idem+${userId}@integration.test`;
      const dto    = { userId, email, password: 'TestPass123!' };

      await expect(authService.provisionCredentials(dto)).resolves.toEqual({ ok: true });
      await expect(authService.provisionCredentials(dto)).resolves.toEqual({ ok: true });
    });
  });

  // ── login ─────────────────────────────────────────────────────────────────

  describe('login()', () => {
    async function seedUser(password = 'ValidPass1!') {
      const userId = randomUUID();
      const email  = `login+${userId}@integration.test`;
      await authService.provisionCredentials({ userId, email, password });
      return { userId, email, password };
    }

    it('returns a signed JWT access token and writes refresh token key to Redis', async () => {
      const { email, password } = await seedUser();

      const { accessToken, refreshToken } = await authService.login({ email, password });

      expect(accessToken).toBeTruthy();
      expect(refreshToken).toBeTruthy();

      // Verify the refresh token entry was written to Redis
      const keys = await redis.keys('refresh:*');
      expect(keys.length).toBeGreaterThan(0);
    });

    it('throws UnauthorizedException on wrong password', async () => {
      const { email } = await seedUser();

      await expect(authService.login({ email, password: 'WrongPass9!' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when credential does not exist', async () => {
      await expect(authService.login({ email: 'nobody@integration.test', password: 'any' }))
        .rejects.toThrow(UnauthorizedException);
    });

    it('locks account in DB after 5 consecutive failed attempts', async () => {
      const { email } = await seedUser();

      for (let i = 0; i < 5; i++) {
        await authService.login({ email, password: 'bad' }).catch(() => {});
      }

      const repo       = dataSource.getRepository(Credential);
      const credential = await repo.findOneOrFail({ where: { email } });
      expect(credential.lockedUntil).not.toBeNull();
      expect(credential.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('throws ForbiddenException on login attempt while account is locked', async () => {
      const { email } = await seedUser();

      // Exhaust the lockout threshold
      for (let i = 0; i < 5; i++) {
        await authService.login({ email, password: 'bad' }).catch(() => {});
      }

      await expect(authService.login({ email, password: 'ValidPass1!' }))
        .rejects.toThrow(ForbiddenException);
    });

    it('clears failure counter from Redis after successful login', async () => {
      const { email, password } = await seedUser();

      // Two failed attempts, then succeed
      await authService.login({ email, password: 'bad' }).catch(() => {});
      await authService.login({ email, password: 'bad' }).catch(() => {});
      await authService.login({ email, password });

      const failureKey = await redis.keys('login-failures:*');
      expect(failureKey).toHaveLength(0);
    });
  });

  // ── refresh ───────────────────────────────────────────────────────────────

  describe('refresh()', () => {
    async function loginUser() {
      const userId = randomUUID();
      const email  = `refresh+${userId}@integration.test`;
      await authService.provisionCredentials({ userId, email, password: 'RefreshPass1!' });
      return authService.login({ email, password: 'RefreshPass1!' });
    }

    it('returns a new token pair and consumes the old refresh token from Redis', async () => {
      const { refreshToken } = await loginUser();

      const keysBefore = await redis.keys('refresh:*');
      const { accessToken: newAccessToken, refreshToken: newRefreshToken } =
        await authService.refresh(refreshToken);

      expect(newAccessToken).toBeTruthy();
      expect(newRefreshToken).toBeTruthy();
      expect(newRefreshToken).not.toBe(refreshToken); // rotated

      // Old key consumed, new key written
      const keysAfter = await redis.keys('refresh:*');
      expect(keysAfter).not.toEqual(expect.arrayContaining(keysBefore));
    });

    it('throws UnauthorizedException if the same refresh token is replayed', async () => {
      const { refreshToken } = await loginUser();

      await authService.refresh(refreshToken);

      // Second use of the same token must fail (GETDEL consumed it)
      await expect(authService.refresh(refreshToken)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for a tampered refresh token', async () => {
      const { refreshToken } = await loginUser();
      const tampered = refreshToken.slice(0, -5) + 'XXXXX';

      await expect(authService.refresh(tampered)).rejects.toThrow(UnauthorizedException);
    });
  });
});

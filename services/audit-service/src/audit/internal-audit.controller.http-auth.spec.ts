import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import * as request from 'supertest';
import { InternalGuard } from '@sgd/common';
import { InternalAuditController } from './internal-audit.controller';
import { AuditService } from './audit.service';

// Companion to internal-audit.controller.spec.ts, which overrides InternalGuard
// entirely — a real test-value for the guard means those tests can't catch a
// removed/misconfigured @UseGuards(InternalGuard) or
// @AllowInternalTokens('INTERNAL_TOKEN_WORKFLOW_AUDIT') on the controller.
// This boots the real module (real guard, real decorator metadata read via
// Reflector) and fires actual HTTP requests at it via supertest, which binds
// its own ephemeral socket per request against app.getHttpServer() — no
// app.listen()/app.close() lifecycle to manage (that combination proved
// flaky under Jest's forceExit on Windows: the process crashed in libuv
// during teardown even though every test had already passed).
describe('InternalAuditController — HTTP, real InternalGuard', () => {
  const VALID_TOKEN = 'test-internal-token-workflow-audit';
  let app: INestApplication;
  let auditService: { export: jest.Mock };

  beforeAll(async () => {
    auditService = { export: jest.fn().mockResolvedValue([{ id: 'log-1' }]) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [InternalAuditController],
      providers: [
        { provide: AuditService, useValue: auditService },
        InternalGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'INTERNAL_TOKEN_WORKFLOW_AUDIT' ? VALID_TOKEN : undefined,
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    auditService.export.mockClear();
  });

  const PATH = '/internal/audit/logs-by-correlation?correlationId=wf-1&orgId=org-1';

  it('reaches the controller (200) when x-internal-token matches INTERNAL_TOKEN_WORKFLOW_AUDIT', async () => {
    await request(app.getHttpServer())
      .get(PATH)
      .set('x-internal-token', VALID_TOKEN)
      .expect(200);

    expect(auditService.export).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: 'wf-1', orgId: 'org-1' }),
      false,
    );
  });

  it('rejects with 401 when x-internal-token is missing', async () => {
    await request(app.getHttpServer()).get(PATH).expect(401);

    expect(auditService.export).not.toHaveBeenCalled();
  });

  it('rejects with 401 when x-internal-token does not match', async () => {
    await request(app.getHttpServer())
      .get(PATH)
      .set('x-internal-token', 'wrong-token')
      .expect(401);

    expect(auditService.export).not.toHaveBeenCalled();
  });
});

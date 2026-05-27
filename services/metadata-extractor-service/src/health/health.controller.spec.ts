import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

// ── HealthController ──────────────────────────────────────────────────────────

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('startup()', () => {
    it('returns status ok with service name', () => {
      const result = controller.startup();
      expect(result).toEqual({ status: 'ok', service: 'metadata-extractor-service' });
    });

    it('always returns "ok" status', () => {
      expect(controller.startup().status).toBe('ok');
    });
  });

  describe('live()', () => {
    it('returns status ok with service name', () => {
      const result = controller.live();
      expect(result).toEqual({ status: 'ok', service: 'metadata-extractor-service' });
    });

    it('always returns "ok" status', () => {
      expect(controller.live().status).toBe('ok');
    });
  });

  describe('ready()', () => {
    it('returns status ok with service name', () => {
      const result = controller.ready();
      expect(result).toEqual({ status: 'ok', service: 'metadata-extractor-service' });
    });

    it('always returns "ok" status', () => {
      expect(controller.ready().status).toBe('ok');
    });
  });

  describe('all probes', () => {
    it('all three probes return the same structure', () => {
      const expected = { status: 'ok', service: 'metadata-extractor-service' };
      expect(controller.startup()).toEqual(expected);
      expect(controller.live()).toEqual(expected);
      expect(controller.ready()).toEqual(expected);
    });
  });
});

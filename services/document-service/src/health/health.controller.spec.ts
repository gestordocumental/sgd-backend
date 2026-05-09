import { HealthController } from './health.controller';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeDeps() {
  const health = {
    check: jest.fn().mockResolvedValue({
      status: 'ok',
      info:    { mongodb: { status: 'up' } },
      error:   {},
      details: { mongodb: { status: 'up' } },
    }),
  };
  const mongoose = {
    pingCheck: jest.fn().mockReturnValue({ mongodb: { status: 'up' } }),
  };
  return { health, mongoose };
}

// ── HealthController ─────────────────────────────────────────────────────────

describe('HealthController', () => {
  describe('startup()', () => {
    it('returns { status: "ok", service: "document-service" }', () => {
      const { health, mongoose } = makeDeps();
      const ctrl = new HealthController(health as any, mongoose as any);

      const result = ctrl.startup();

      expect(result).toEqual({ status: 'ok', service: 'document-service' });
    });
  });

  describe('live()', () => {
    it('returns { status: "ok", service: "document-service" }', () => {
      const { health, mongoose } = makeDeps();
      const ctrl = new HealthController(health as any, mongoose as any);

      const result = ctrl.live();

      expect(result).toEqual({ status: 'ok', service: 'document-service' });
    });
  });

  describe('ready()', () => {
    it('calls health.check with a mongoose pingCheck indicator', async () => {
      const { health, mongoose } = makeDeps();
      const ctrl = new HealthController(health as any, mongoose as any);

      const result = await ctrl.ready();

      expect(health.check).toHaveBeenCalledWith([expect.any(Function)]);
      expect(result).toMatchObject({ status: 'ok' });
    });

    it('calls mongoose.pingCheck with "mongodb" key inside the indicator function', async () => {
      const { health, mongoose } = makeDeps();
      const ctrl = new HealthController(health as any, mongoose as any);

      // Intercept the indicator functions passed to health.check
      health.check.mockImplementation(async (indicators: (() => any)[]) => {
        // Execute the first (and only) indicator
        indicators[0]();
        return { status: 'ok' };
      });

      await ctrl.ready();

      expect(mongoose.pingCheck).toHaveBeenCalledWith('mongodb');
    });

    it('propagates errors from health.check (db unreachable)', async () => {
      const { health, mongoose } = makeDeps();
      health.check.mockRejectedValue(new Error('MongoDB unreachable'));
      const ctrl = new HealthController(health as any, mongoose as any);

      await expect(ctrl.ready()).rejects.toThrow('MongoDB unreachable');
    });
  });
});

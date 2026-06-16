import { InternalServerErrorException } from '@nestjs/common';
import * as net from 'net';
import { ClamavService } from './clamav.service';

jest.mock('net');

// ── Helpers ────────────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, unknown> = {}) {
  const defaults: Record<string, unknown> = {
    CLAMAV_HOST:       'localhost',
    CLAMAV_PORT:       3310,
    CLAMAV_TIMEOUT_MS: 15000,
    CLAMAV_REQUIRED:   'false',
  };
  return {
    get: jest.fn(<T>(key: string, fallback?: T): T => {
      const source = { ...defaults, ...overrides };
      return (key in source ? source[key] : fallback) as T;
    }),
  };
}

const makeLogger = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

type MockSocket = {
  setTimeout: jest.Mock;
  connect:    jest.Mock;
  write:      jest.Mock;
  on:         jest.Mock;
  destroy:    jest.Mock;
};

function makeMockSocket(): { socket: MockSocket; handlers: Record<string, (...a: any[]) => void> } {
  const handlers: Record<string, (...a: any[]) => void> = {};
  const socket: MockSocket = {
    setTimeout: jest.fn(),
    connect:    jest.fn(),
    write:      jest.fn(),
    on:         jest.fn((event: string, cb: (...a: any[]) => void) => { handlers[event] = cb; }),
    destroy:    jest.fn(),
  };
  return { socket, handlers };
}

// ── ClamavService ──────────────────────────────────────────────────────────

describe('ClamavService', () => {

  // ── constructor ────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('initializes successfully with valid config', () => {
      expect(() => new ClamavService(makeConfig() as any, makeLogger() as any)).not.toThrow();
    });

    it('throws when CLAMAV_PORT is a non-numeric string', () => {
      expect(() => new ClamavService(makeConfig({ CLAMAV_PORT: 'abc' }) as any, makeLogger() as any))
        .toThrow('CLAMAV_PORT must be a positive number');
    });

    it('throws when CLAMAV_PORT is 0', () => {
      expect(() => new ClamavService(makeConfig({ CLAMAV_PORT: 0 }) as any, makeLogger() as any))
        .toThrow('CLAMAV_PORT must be a positive number');
    });

    it('throws when CLAMAV_PORT is negative', () => {
      expect(() => new ClamavService(makeConfig({ CLAMAV_PORT: -1 }) as any, makeLogger() as any))
        .toThrow('CLAMAV_PORT must be a positive number');
    });

    it('throws when CLAMAV_TIMEOUT_MS is an empty string', () => {
      expect(() => new ClamavService(makeConfig({ CLAMAV_TIMEOUT_MS: '' }) as any, makeLogger() as any))
        .toThrow('CLAMAV_TIMEOUT_MS must be a positive number');
    });

    it('throws when CLAMAV_TIMEOUT_MS is 0', () => {
      expect(() => new ClamavService(makeConfig({ CLAMAV_TIMEOUT_MS: 0 }) as any, makeLogger() as any))
        .toThrow('CLAMAV_TIMEOUT_MS must be a positive number');
    });
  });

  // ── scan() ────────────────────────────────────────────────────────────────

  describe('scan()', () => {
    let socket: MockSocket;
    let handlers: Record<string, (...a: any[]) => void>;

    beforeEach(() => {
      ({ socket, handlers } = makeMockSocket());
      (net.Socket as unknown as jest.Mock).mockImplementation(() => socket);
    });

    function makeService(required = false) {
      const logger = makeLogger();
      const svc = new ClamavService(
        makeConfig({ CLAMAV_REQUIRED: required ? 'true' : 'false' }) as any,
        logger as any,
      );
      return { svc, logger };
    }

    function triggerConnect() {
      (socket.connect.mock.calls[0][2] as () => void)();
    }

    it('resolves clean:true when ClamAV responds OK', async () => {
      const { svc } = makeService();
      const p = svc.scan(Buffer.from('data'));

      triggerConnect();
      handlers['data'](Buffer.from('stream: OK\0'));
      handlers['end']();

      await expect(p).resolves.toEqual({ clean: true });
    });

    it('resolves with threat name when ClamAV detects malware', async () => {
      const { svc } = makeService();
      const p = svc.scan(Buffer.from('data'));

      triggerConnect();
      handlers['data'](Buffer.from('stream: Eicar-Test-Signature FOUND\0'));
      handlers['end']();

      await expect(p).resolves.toEqual({ clean: false, threat: 'Eicar-Test-Signature' });
    });

    it('resolves clean:true on socket error when CLAMAV_REQUIRED=false (fail-open)', async () => {
      const { svc, logger } = makeService(false);
      const p = svc.scan(Buffer.from('data'));

      handlers['error'](new Error('ECONNREFUSED'));

      await expect(p).resolves.toEqual({ clean: true });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('throws InternalServerErrorException on socket error when CLAMAV_REQUIRED=true (fail-closed)', async () => {
      const { svc, logger } = makeService(true);
      const p = svc.scan(Buffer.from('data'));

      handlers['error'](new Error('ECONNREFUSED'));

      await expect(p).rejects.toThrow(InternalServerErrorException);
      expect(logger.error).toHaveBeenCalled();
    });

    it('resolves clean:true on timeout when CLAMAV_REQUIRED=false', async () => {
      const { svc, logger } = makeService(false);
      const p = svc.scan(Buffer.from('data'));

      handlers['timeout']();

      await expect(p).resolves.toEqual({ clean: true });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('throws InternalServerErrorException on timeout when CLAMAV_REQUIRED=true', async () => {
      const { svc, logger } = makeService(true);
      const p = svc.scan(Buffer.from('data'));

      handlers['timeout']();

      await expect(p).rejects.toThrow(InternalServerErrorException);
      expect(logger.error).toHaveBeenCalled();
    });

    it('resolves clean:true on unexpected ClamAV response when CLAMAV_REQUIRED=false', async () => {
      const { svc, logger } = makeService(false);
      const p = svc.scan(Buffer.from('data'));

      triggerConnect();
      handlers['data'](Buffer.from('stream: SOMETHING UNEXPECTED\0'));
      handlers['end']();

      await expect(p).resolves.toEqual({ clean: true });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('throws InternalServerErrorException on unexpected ClamAV response when CLAMAV_REQUIRED=true', async () => {
      const { svc, logger } = makeService(true);
      const p = svc.scan(Buffer.from('data'));

      triggerConnect();
      handlers['data'](Buffer.from('stream: SOMETHING UNEXPECTED\0'));
      handlers['end']();

      await expect(p).rejects.toThrow(InternalServerErrorException);
      expect(logger.error).toHaveBeenCalled();
    });
  });
});

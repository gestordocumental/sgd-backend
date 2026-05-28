import { SseTicketService } from './sse-ticket.service';

// Minimal Redis mock: setex stores key → value with a TTL; get/del work accordingly.
function makeRedisMock() {
  const store = new Map<string, { value: string; expiresAt: number }>();

  return {
    setex: jest.fn(async (key: string, ttlSeconds: number, value: string) => {
      store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
      return 'OK';
    }),
    get: jest.fn(async (key: string) => {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        store.delete(key);
        return null;
      }
      return entry.value;
    }),
    del: jest.fn(async (key: string) => {
      return store.delete(key) ? 1 : 0;
    }),
    _store: store,
  };
}

describe('SseTicketService', () => {
  let service: SseTicketService;
  let redis: ReturnType<typeof makeRedisMock>;

  beforeEach(() => {
    jest.useFakeTimers();
    redis = makeRedisMock();
    service = new SseTicketService(redis as any);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // ─── create ─────────────────────────────────────────────────────────────────

  it('create() returns a UUID string', async () => {
    const ticket = await service.create('user-1');
    expect(typeof ticket).toBe('string');
    expect(ticket).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('create() stores the ticket in Redis with 30s TTL', async () => {
    await service.create('user-1');
    expect(redis.setex).toHaveBeenCalledWith(
      expect.stringMatching(/^sse-ticket:/),
      30,
      'user-1',
    );
  });

  it('create() returns a different ticket each call', async () => {
    const a = await service.create('user-1');
    const b = await service.create('user-1');
    expect(a).not.toBe(b);
  });

  // ─── validate ────────────────────────────────────────────────────────────────

  it('validate() returns the userId for a valid ticket', async () => {
    const ticket = await service.create('user-1');
    await expect(service.validate(ticket)).resolves.toBe('user-1');
  });

  it('validate() is multi-use — second call also returns userId (allows EventSource auto-reconnect)', async () => {
    const ticket = await service.create('user-1');
    await expect(service.validate(ticket)).resolves.toBe('user-1');
    await expect(service.validate(ticket)).resolves.toBe('user-1');
  });

  it('validate() returns null for an unknown ticket', async () => {
    await expect(service.validate('00000000-0000-0000-0000-000000000000')).resolves.toBeNull();
  });

  it('validate() returns null for an expired ticket', async () => {
    const ticket = await service.create('user-1');
    jest.advanceTimersByTime(30_001);
    await expect(service.validate(ticket)).resolves.toBeNull();
  });

  // ─── revoke ──────────────────────────────────────────────────────────────────

  it('revoke() removes the ticket so validate() returns null', async () => {
    const ticket = await service.create('user-1');
    await service.revoke(ticket);
    await expect(service.validate(ticket)).resolves.toBeNull();
  });
});

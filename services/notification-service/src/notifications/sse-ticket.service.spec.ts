import { SseTicketService } from './sse-ticket.service';

describe('SseTicketService', () => {
  let service: SseTicketService;

  beforeEach(() => {
    jest.useFakeTimers();
    service = new SseTicketService();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  // ─── create ─────────────────────────────────────────────────────────────────

  it('create() returns a UUID string', () => {
    const ticket = service.create('user-1');
    expect(typeof ticket).toBe('string');
    expect(ticket).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('create() returns a different ticket each call', () => {
    const a = service.create('user-1');
    const b = service.create('user-1');
    expect(a).not.toBe(b);
  });

  // ─── consume ────────────────────────────────────────────────────────────────

  it('consume() returns the userId for a valid ticket', () => {
    const ticket = service.create('user-1');
    expect(service.consume(ticket)).toBe('user-1');
  });

  it('consume() is single-use — second call returns null', () => {
    const ticket = service.create('user-1');
    service.consume(ticket);
    expect(service.consume(ticket)).toBeNull();
  });

  it('consume() returns null for an unknown ticket', () => {
    expect(service.consume('00000000-0000-0000-0000-000000000000')).toBeNull();
  });

  it('consume() returns null for an expired ticket', () => {
    const ticket = service.create('user-1');
    jest.advanceTimersByTime(30_001); // past 30 s TTL
    expect(service.consume(ticket)).toBeNull();
  });

  // ─── cleanup ────────────────────────────────────────────────────────────────

  it('periodic cleanup removes expired tickets so consume returns null', () => {
    const ticket = service.create('user-1');
    jest.advanceTimersByTime(60_001); // cleanup interval fires at 60 s; ticket expired at 30 s
    expect(service.consume(ticket)).toBeNull();
  });

  // ─── onModuleDestroy ────────────────────────────────────────────────────────

  it('onModuleDestroy() clears the interval without throwing', () => {
    expect(() => service.onModuleDestroy()).not.toThrow();
  });
});

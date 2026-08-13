/**
 * True for 4xx statuses that are deterministic client/business errors (not found,
 * forbidden, validation) — repeating the exact same request wouldn't succeed, so
 * they must not count as a circuit failure. 408 (timeout) and 429 (rate limited)
 * are deliberately excluded: they signal the callee is struggling, not that the
 * request itself was bad, so they must trip the circuit the same way a 5xx would.
 *
 * Shared across every internal HTTP client's opossum `errorFilter` — this is a
 * cross-cutting resilience policy, not a per-client detail. Keep it here, not
 * copy-pasted per client: a fork left behind while another copy gains a new
 * exception (e.g. 503 with Retry-After, or 425) silently diverges the two
 * circuits' behavior with nothing to catch it.
 */
export function isNonTrippingClientError(status: unknown): boolean {
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429;
}

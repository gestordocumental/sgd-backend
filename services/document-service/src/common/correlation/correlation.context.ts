import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationStore {
  correlationId: string;
  clientIp: string | null;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

/**
 * Retrieve the correlation identifier associated with the current async execution context.
 *
 * @returns The current context's `correlationId`, or the literal `'no-correlation-id'` when no context is available.
 */
export function getCorrelationId(): string {
  return correlationStorage.getStore()?.correlationId ?? 'no-correlation-id';
}

/**
 * Retrieve the client IP address from the current async execution context.
 *
 * @returns The client IP address from the current context, or `null` if no context is available or the IP is not set.
 */
export function getClientIp(): string | null {
  return correlationStorage.getStore()?.clientIp ?? null;
}

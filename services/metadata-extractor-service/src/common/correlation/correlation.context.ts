import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationStore { correlationId: string; }

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

/**
 * Retrieve the correlation identifier associated with the current asynchronous context.
 *
 * @returns The current context's `correlationId`, or `'no-correlation-id'` when no correlation id is set
 */
export function getCorrelationId(): string {
  return correlationStorage.getStore()?.correlationId ?? 'no-correlation-id';
}

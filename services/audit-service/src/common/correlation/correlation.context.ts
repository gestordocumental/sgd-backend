import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationStore {
  correlationId: string;
}

export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

/**
 * Retrieve the current correlation ID for the active async context.
 *
 * @returns The `correlationId` from the active store, or `'no-correlation-id'` when no store is present
 */
export function getCorrelationId(): string {
  return correlationStorage.getStore()?.correlationId ?? 'no-correlation-id';
}

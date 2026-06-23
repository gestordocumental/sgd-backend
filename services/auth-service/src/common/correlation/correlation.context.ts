import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationStore {
  correlationId: string;
}

// Single instance shared across the entire application
export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

/**
 * Retrieve the current execution's correlation identifier.
 *
 * @returns The `correlationId` stored in the current async context, or `'no-correlation-id'` when no context is present.
 */
export function getCorrelationId(): string {
  return correlationStorage.getStore()?.correlationId ?? 'no-correlation-id';
}

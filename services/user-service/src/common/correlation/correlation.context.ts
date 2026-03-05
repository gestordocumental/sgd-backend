import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationStore {
  correlationId: string;
}

// Single instance shared across the entire application
export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function getCorrelationId(): string {
  return correlationStorage.getStore()?.correlationId ?? 'no-correlation-id';
}

import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationStore {
  correlationId: string;
  clientIp: string | null;
}

// Single instance shared across the entire application
export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function getCorrelationId(): string {
  return correlationStorage.getStore()?.correlationId ?? 'no-correlation-id';
}

export function getClientIp(): string | null {
  return correlationStorage.getStore()?.clientIp ?? null;
}

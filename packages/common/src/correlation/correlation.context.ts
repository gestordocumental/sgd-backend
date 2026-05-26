import { AsyncLocalStorage } from 'async_hooks';

export interface CorrelationStore {
  correlationId: string;
  clientIp?: string | null;
  [key: string]: unknown;
}

// Single instance shared across the entire process
export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function getCorrelationId(): string {
  return correlationStorage.getStore()?.correlationId ?? 'no-correlation-id';
}

export function getClientIp(): string | null {
  return correlationStorage.getStore()?.clientIp ?? null;
}

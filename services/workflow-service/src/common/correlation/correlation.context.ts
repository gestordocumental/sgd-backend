import { AsyncLocalStorage } from 'async_hooks';

interface CorrelationStore {
  correlationId: string;
  clientIp: string | null;
}

// Instancia única compartida en toda la aplicación
export const correlationStorage = new AsyncLocalStorage<CorrelationStore>();

export function getCorrelationId(): string {
  return correlationStorage.getStore()?.correlationId ?? 'no-correlation-id';
}

export function getClientIp(): string | null {
  return correlationStorage.getStore()?.clientIp ?? null;
}

import { randomUUID } from 'crypto';
import { KafkaMessage } from 'kafkajs';
import { correlationStorage } from '../correlation/correlation.context';

/**
 * Run an async function inside `correlationStorage` using a correlation ID derived from a Kafka message.
 *
 * The correlation ID is taken from the Kafka header `x-correlation-id` (a non-empty Buffer is converted to string, a non-empty string is used as-is); if absent or empty a new UUID is generated.
 *
 * @param message - Kafka message whose `x-correlation-id` header is used to derive the correlation ID
 * @param fn - Async callback to execute within the correlation context
 * @returns Resolves with no value when `fn` completes; rejects with the same error if `fn` throws
 */
export function runWithCorrelation(message: KafkaMessage, fn: () => Promise<void>): Promise<void> {
  const raw = message.headers?.['x-correlation-id'];
  const correlationId =
    Buffer.isBuffer(raw) && raw.length > 0 ? raw.toString()
    : typeof raw === 'string' && raw.length > 0 ? raw
    : randomUUID();

  return new Promise((resolve, reject) => {
    correlationStorage.run({ correlationId }, async () => {
      try { await fn(); resolve(); }
      catch (err) { reject(err); }
    });
  });
}

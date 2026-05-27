import { randomUUID } from 'crypto';
import { KafkaMessage } from 'kafkajs';
import { correlationStorage } from '../correlation/correlation.context';

/**
 * Execute a callback within a correlation context derived from the message's `x-correlation-id` header.
 *
 * The correlation id is taken from `message.headers['x-correlation-id']` (supports `Buffer` and `string`); if absent or empty a new UUID is generated.
 *
 * @param message - Incoming Kafka message used to obtain the `x-correlation-id` header
 * @param fn - Async callback to execute inside the established correlation context
 * @returns `void` when the callback completes successfully; rethrows any error thrown by the callback
 */
export function runWithCorrelation(
  message: KafkaMessage,
  fn: () => Promise<void>,
): Promise<void> {
  const raw = message.headers?.['x-correlation-id'];
  const correlationId =
    Buffer.isBuffer(raw) && raw.length > 0
      ? raw.toString()
      : typeof raw === 'string' && raw.length > 0
        ? raw
        : randomUUID();

  return new Promise((resolve, reject) => {
    correlationStorage.run({ correlationId }, async () => {
      try {
        await fn();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

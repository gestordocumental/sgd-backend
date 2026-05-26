import { randomUUID } from 'crypto';
import { KafkaMessage } from 'kafkajs';
import { correlationStorage } from '../correlation/correlation.context';

/**
 * Run a function inside a correlation context derived from the Kafka message.
 *
 * The correlation ID is taken from `message.headers?.['x-correlation-id']`:
 * - if it's a non-empty `Buffer`, it is converted to a string;
 * - if it's a non-empty `string`, it is used as-is;
 * - otherwise a new UUID is generated.
 *
 * @param message - The Kafka message whose headers may contain `x-correlation-id`
 * @param fn - The async function to execute within the correlation context
 * @returns A promise that resolves when `fn` completes successfully, or rejects with the error thrown by `fn`
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
    correlationStorage.run({ correlationId, clientIp: null }, async () => {
      try {
        await fn();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

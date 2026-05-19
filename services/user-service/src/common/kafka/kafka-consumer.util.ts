import { randomUUID } from 'crypto';
import { KafkaMessage } from 'kafkajs';
import { correlationStorage } from '../correlation/correlation.context';

/**
 * Extracts x-correlation-id from a Kafka message header and runs the
 * handler inside an AsyncLocalStorage correlation context.
 *
 * This ensures every log line emitted during message processing carries
 * the same correlationId as the original HTTP request that triggered the event.
 *
 * Usage in a Kafka consumer handler:
 *
 *   await runWithCorrelation(message, () => this.handleDocumentCreated(payload));
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
        : randomUUID(); // fallback: event arrived without a correlationId

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

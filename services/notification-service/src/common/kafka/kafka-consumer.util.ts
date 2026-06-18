import { randomUUID } from 'crypto';
import { KafkaMessage } from 'kafkajs';
import { correlationStorage } from '../correlation/correlation.context';

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

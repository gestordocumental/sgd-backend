import { randomUUID } from 'crypto';
import { KafkaMessage } from 'kafkajs';
import { correlationStorage } from '../correlation/correlation.context';
import type { AppLogger } from '../logger/app-logger.service';
import type { KafkaProducerService } from './kafka-producer.service';

/**
 * Runs the given async handler inside an AsyncLocalStorage context seeded
 * with the correlationId from the Kafka message headers. Generates a new
 * UUID if the header is absent, ensuring every consumer handler has a
 * traceable correlationId without any manual plumbing.
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

interface WithDltParams {
  topic: string;
  message: KafkaMessage;
  producer: KafkaProducerService;
  logger: AppLogger;
  context: string;
  /** Total number of attempts before routing to DLT. Default: 3 */
  retries?: number;
  /** Base delay in ms for exponential backoff. Default: 300 */
  initialDelayMs?: number;
}

/**
 * Wraps a Kafka message handler with exponential-backoff retry and automatic
 * Dead Letter Topic (DLT) routing.
 *
 * - Retries the handler up to `retries` times with exponential backoff.
 * - After all attempts are exhausted, publishes the original message to
 *   `{topic}.dlt` so it can be inspected and replayed manually.
 * - **Never throws** — the Kafka consumer always advances the offset.
 *
 * DLT naming convention: `{originalTopic}.dlt`
 * e.g. `audit.log` → `audit.log.dlt`
 */
export async function withDlt(
  params: WithDltParams,
  handler: () => Promise<void>,
): Promise<void> {
  const maxAttempts = params.retries ?? 3;
  const initialDelayMs = params.initialDelayMs ?? 300;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await handler();
      return;
    } catch (err) {
      const isLast = attempt === maxAttempts;

      if (isLast) {
        params.logger.error(
          `[kafka] All ${maxAttempts} attempts failed for topic "${params.topic}" — routing to DLT`,
          err instanceof Error ? err.stack : undefined,
          params.context,
        );
        try {
          await params.producer.emitToDlt(params.topic, params.message);
        } catch (dltErr) {
          params.logger.error(
            `[kafka] Failed to publish to DLT for topic "${params.topic}": ${dltErr instanceof Error ? dltErr.message : String(dltErr)}`,
            dltErr instanceof Error ? dltErr.stack : undefined,
            params.context,
          );
        }
        // Never re-throw — let Kafka commit the offset and move on.
      } else {
        const delayMs = initialDelayMs * 2 ** (attempt - 1);
        params.logger.warn(
          `[kafka] Attempt ${attempt}/${maxAttempts} failed for topic "${params.topic}": ${err instanceof Error ? err.message : String(err)} — retrying in ${delayMs}ms`,
          params.context,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}

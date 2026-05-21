import { KafkaMessage } from 'kafkajs';
import { getClientIp, getCorrelationId } from '../correlation/correlation.context';
import { runWithCorrelation } from './kafka-consumer.util';

describe('runWithCorrelation', () => {
  it('uses a buffer correlation id header while the handler runs', async () => {
    const message = {
      headers: { 'x-correlation-id': Buffer.from('corr-buffer') },
    } as unknown as KafkaMessage;

    await runWithCorrelation(message, async () => {
      expect(getCorrelationId()).toBe('corr-buffer');
      expect(getClientIp()).toBeNull();
    });
  });

  it('uses a string correlation id header', async () => {
    const message = {
      headers: { 'x-correlation-id': 'corr-string' },
    } as unknown as KafkaMessage;

    await runWithCorrelation(message, async () => {
      expect(getCorrelationId()).toBe('corr-string');
    });
  });

  it('generates a fallback correlation id when the header is empty', async () => {
    const message = {
      headers: { 'x-correlation-id': Buffer.alloc(0) },
    } as unknown as KafkaMessage;

    await runWithCorrelation(message, async () => {
      expect(getCorrelationId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  it('rejects when the handler fails', async () => {
    const message = { headers: {} } as KafkaMessage;

    await expect(
      runWithCorrelation(message, async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
  });
});

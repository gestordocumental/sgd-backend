import { KafkaMessage } from 'kafkajs';
import { getCorrelationId } from '../correlation/correlation.context';
import { runWithCorrelation } from './kafka-consumer.util';

function makeMessage(correlationId?: string | Buffer): KafkaMessage {
  return {
    headers: correlationId !== undefined ? { 'x-correlation-id': correlationId } : {},
    key: null,
    value: Buffer.from('{}'),
    timestamp: '0',
    attributes: 0,
    offset: '0',
  };
}

describe('runWithCorrelation', () => {
  it('uses a buffer correlation id while the handler runs', async () => {
    await runWithCorrelation(makeMessage(Buffer.from('corr-buffer')), async () => {
      expect(getCorrelationId()).toBe('corr-buffer');
    });
  });

  it('uses a string correlation id while the handler runs', async () => {
    await runWithCorrelation(makeMessage('corr-string'), async () => {
      expect(getCorrelationId()).toBe('corr-string');
    });
  });

  it('generates a fallback correlation id when the header is missing', async () => {
    await runWithCorrelation(makeMessage(), async () => {
      expect(getCorrelationId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  it('generates a fallback correlation id when the header is empty', async () => {
    await runWithCorrelation(makeMessage(Buffer.alloc(0)), async () => {
      expect(getCorrelationId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  it('rejects when the handler fails', async () => {
    await expect(
      runWithCorrelation(makeMessage('corr-error'), async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
  });
});

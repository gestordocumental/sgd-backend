import { KafkaMessage } from 'kafkajs';
import { runWithCorrelation } from './kafka-consumer.util';

function makeMsg(correlationId?: string | Buffer): KafkaMessage {
  return {
    headers:    correlationId !== undefined ? { 'x-correlation-id': correlationId } : {},
    key:        null,
    value:      Buffer.from('{}'),
    timestamp:  '0',
    attributes: 0,
    offset:     '0',
  };
}

describe('runWithCorrelation', () => {
  it('runs the function and resolves', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await runWithCorrelation(makeMsg('my-corr-id'), fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects when fn throws', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(runWithCorrelation(makeMsg('my-corr-id'), fn)).rejects.toThrow('fail');
  });

  it('uses Buffer correlation id', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await runWithCorrelation(makeMsg(Buffer.from('buf-corr-id')), fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('generates a UUID when no correlation id header', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await runWithCorrelation(makeMsg(), fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('generates a UUID when correlation id is empty string', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await runWithCorrelation(makeMsg(''), fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('generates a UUID when correlation id is empty Buffer', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);
    await runWithCorrelation(makeMsg(Buffer.from('')), fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

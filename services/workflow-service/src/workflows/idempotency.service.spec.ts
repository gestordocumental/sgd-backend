import { Repository } from 'typeorm';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyKey } from './entities/idempotency-key.entity';

function makeRepo() {
  return {
    findOne: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    upsert: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<
    Pick<Repository<IdempotencyKey>, 'findOne' | 'delete' | 'upsert'>
  >;
}

describe('IdempotencyService', () => {
  it('returns null when the idempotency key does not exist', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValue(null);
    const service = new IdempotencyService(repo as unknown as Repository<IdempotencyKey>);

    await expect(service.get('key-1', 'user-1')).resolves.toBeNull();

    expect(repo.findOne).toHaveBeenCalledWith({
      where: { idemKey: 'key-1', userId: 'user-1' },
    });
  });

  it('returns parsed cached responses before they expire', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValue({
      idemKey: 'key-1',
      userId: 'user-1',
      response: JSON.stringify({ ok: true }),
      expiresAt: new Date(Date.now() + 60_000),
    } as IdempotencyKey);
    const service = new IdempotencyService(repo as unknown as Repository<IdempotencyKey>);

    await expect(service.get<{ ok: boolean }>('key-1', 'user-1')).resolves.toEqual({
      ok: true,
    });

    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('returns null and schedules cleanup for expired cached responses', async () => {
    const repo = makeRepo();
    repo.findOne.mockResolvedValue({
      idemKey: 'key-1',
      userId: 'user-1',
      response: JSON.stringify({ ok: true }),
      expiresAt: new Date(Date.now() - 60_000),
    } as IdempotencyKey);
    const service = new IdempotencyService(repo as unknown as Repository<IdempotencyKey>);

    await expect(service.get('key-1', 'user-1')).resolves.toBeNull();

    expect(repo.delete).toHaveBeenCalledWith('key-1');
  });

  it('stores responses with a 24 hour expiration using upsert', async () => {
    const repo = makeRepo();
    const service = new IdempotencyService(repo as unknown as Repository<IdempotencyKey>);

    await service.set('key-1', 'user-1', { id: 'workflow-1' });

    expect(repo.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        idemKey: 'key-1',
        userId: 'user-1',
        response: JSON.stringify({ id: 'workflow-1' }),
        expiresAt: expect.any(Date),
      }),
      ['idemKey'],
    );
  });
});

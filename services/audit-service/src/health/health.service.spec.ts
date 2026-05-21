import { ElasticsearchService } from '@nestjs/elasticsearch';
import { Kafka } from 'kafkajs';
import { HealthService } from './health.service';

describe('HealthService', () => {
  let service: HealthService;
  let es:      jest.Mocked<Pick<ElasticsearchService, 'ping'>>;
  let admin:   { connect: jest.Mock; disconnect: jest.Mock };
  let kafka:   jest.Mocked<Pick<Kafka, 'admin'>>;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    admin = {
      connect:    jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    kafka   = { admin: jest.fn().mockReturnValue(admin) } as any;
    es      = { ping: jest.fn().mockResolvedValue(true) } as any;
    service = new HealthService(
      es    as unknown as ElasticsearchService,
      kafka as unknown as Kafka,
    );
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns true when both ES and Kafka are reachable', async () => {
    expect(await service.checkDependencies()).toBe(true);
  });

  it('returns false when ES ping fails', async () => {
    es.ping.mockRejectedValue(new Error('ES down'));
    expect(await service.checkDependencies()).toBe(false);
  });

  it('returns false when Kafka connect fails', async () => {
    admin.connect.mockRejectedValue(new Error('Kafka down'));
    expect(await service.checkDependencies()).toBe(false);
  });

  it('always disconnects kafka admin even when connect fails', async () => {
    admin.connect.mockRejectedValue(new Error('Kafka down'));
    await service.checkDependencies();
    expect(admin.disconnect).toHaveBeenCalled();
  });
});

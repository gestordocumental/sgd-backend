import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyKey } from './entities/idempotency-key.entity';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

@Injectable()
export class IdempotencyService {
  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly repo: Repository<IdempotencyKey>,
  ) {}

  /**
   * Busca una respuesta cacheada para la clave dada.
   * Devuelve null si no existe o ha expirado.
   */
  async get<T>(key: string, userId: string): Promise<T | null> {
    const record = await this.repo.findOne({ where: { idemKey: key, userId } });
    if (!record) return null;
    if (record.expiresAt < new Date()) {
      // Entrada expirada — limpiar de forma no bloqueante
      void this.repo.delete(key);
      return null;
    }
    return JSON.parse(record.response) as T;
  }

  /**
   * Almacena la respuesta de la operación con un TTL de 24 h.
   * Usa upsert para manejar el caso (raro) de clave duplicada en condición de carrera.
   */
  async set(key: string, userId: string, response: unknown): Promise<void> {
    const expiresAt = new Date(Date.now() + TTL_MS);
    await this.repo.upsert(
      { idemKey: key, userId, response: JSON.stringify(response), expiresAt },
      ['idemKey'],
    );
  }
}

import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Almacena claves de idempotencia para operaciones críticas de transición de estado.
 * TTL: 24 h. Un cliente puede reenviar la misma Idempotency-Key y recibir
 * la respuesta cacheada sin que la acción se ejecute dos veces.
 */
@Entity('workflow_idempotency_keys')
export class IdempotencyKey {
  /** Valor del header Idempotency-Key enviado por el cliente (UUID v4 recomendado) */
  @PrimaryColumn({ name: 'idem_key', type: 'varchar', length: 255 })
  idemKey!: string;

  /** Vincula la clave al usuario que inició la acción — evita que un usuario reutilice la clave de otro */
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  /** Respuesta JSON serializada de la operación original */
  @Column({ name: 'response', type: 'text' })
  response!: string;

  /** Momento en que la entrada expira y puede ser descartada */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}

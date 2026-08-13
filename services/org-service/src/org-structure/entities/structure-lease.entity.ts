import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type StructureType = 'departamento' | 'area' | 'cargo';

/**
 * Short-TTL claim proving a departamento/area/cargo was ACTIVE at the
 * moment document-service/user-service resolved it, right before they
 * persist a new/changed reference against it (BulkStructureService.
 * resolveStructureById() inserts these rows). Departamentos/Areas/Cargos
 * services check for active (non-expired) leases before soft-deleting a
 * node, inside the same `pessimistic_write`-locked transaction that already
 * guards the org-service-internal create-vs-delete race (see
 * DepartamentosService.findOneLocked()) — resolveStructureById() takes the
 * paired `pessimistic_read` lock on the same row before inserting a lease,
 * so Postgres serializes the two exactly like it already does for
 * cargo/area creation vs departamento/area deletion.
 *
 * No explicit release: a lease is inert once `expiresAt` passes, so a
 * crashed caller (never completes its write) just lets the delete proceed
 * once the TTL elapses, instead of blocking forever. No status/version
 * column exists on the structure entities themselves — Postgres transaction
 * rollback already returns them to their prior state on any failure, so
 * there is no "stuck" state to recover from.
 */
@Entity('structure_leases')
@Index(['structureType', 'structureId', 'expiresAt'])
export class StructureLease {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'org_id', type: 'uuid' })
  orgId!: string;

  @Column({ name: 'structure_type', type: 'varchar', length: 20 })
  structureType!: StructureType;

  @Column({ name: 'structure_id', type: 'uuid' })
  structureId!: string;

  /** Calling service name, best-effort — not populated yet, kept for future debugging. */
  @Column({ name: 'requested_by', type: 'varchar', length: 50, nullable: true })
  requestedBy!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Area } from './area.entity';

@Entity('cargos')
export class Cargo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Cross-service reference — no real FK (Database per Service) */
  @Index()
  @Column({ name: 'org_id', type: 'uuid' })
  orgId!: string;

  /**
   * Null when the cargo belongs directly to a departamento (no area).
   * Unique indexes are managed in migration MakeCargoAreaNullable1775400000000.
   */
  @Index()
  @Column({ name: 'area_id', type: 'uuid', nullable: true })
  areaId!: string | null;

  /**
   * Denormalized for easy filtering without joins.
   * Set on creation from area.departamentoId.
   */
  @Index()
  @Column({ name: 'departamento_id', type: 'uuid' })
  departamentoId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @ManyToOne(() => Area, (a) => a.cargos, { onDelete: 'RESTRICT', nullable: true, eager: false })
  @JoinColumn({ name: 'area_id' })
  area!: Area | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

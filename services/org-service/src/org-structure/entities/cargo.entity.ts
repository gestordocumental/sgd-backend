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
@Index(['areaId', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class Cargo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Cross-service reference — no real FK (Database per Service) */
  @Index()
  @Column({ name: 'org_id', type: 'uuid' })
  orgId!: string;

  @Index()
  @Column({ name: 'area_id', type: 'uuid' })
  areaId!: string;

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

  @ManyToOne(() => Area, (a) => a.cargos, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'area_id' })
  area!: Area;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

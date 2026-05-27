import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Departamento } from './departamento.entity';
import { Cargo } from './cargo.entity';

@Entity('areas')
@Index(['departamentoId', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class Area {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Cross-service reference — no real FK (Database per Service) */
  @Index()
  @Column({ name: 'org_id', type: 'uuid' })
  orgId!: string;

  @Index()
  @Column({ name: 'departamento_id', type: 'uuid' })
  departamentoId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @ManyToOne(() => Departamento, (d) => d.areas, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'departamento_id' })
  departamento!: Departamento;

  @OneToMany(() => Cargo, (c) => c.area)
  cargos!: Cargo[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { Area } from './area.entity';

@Entity('departamentos')
@Index(['orgId', 'name'], { unique: true, where: '"deleted_at" IS NULL' })
export class Departamento {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Cross-service reference — no real FK (Database per Service) */
  @Index()
  @Column({ name: 'org_id', type: 'uuid' })
  orgId!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @OneToMany(() => Area, (area) => area.departamento)
  areas!: Area[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;
}

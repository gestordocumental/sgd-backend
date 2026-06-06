import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Org } from './orgs/entities/org.entity';
import { Departamento } from './org-structure/entities/departamento.entity';
import { Area } from './org-structure/entities/area.entity';
import { Cargo } from './org-structure/entities/cargo.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'org_db',
  entities: [Org, Departamento, Area, Cargo],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  // 'each' envuelve cada migración en su propia transacción y permite que
  // migraciones individuales declaren transaction=false (necesario para
  // CREATE INDEX CONCURRENTLY, que no puede correr dentro de una transacción).
  migrationsTransactionMode: 'each',
});

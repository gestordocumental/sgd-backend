import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Credential } from './auth/entities/credential.entity';

const dbPortRaw = process.env.DB_PORT ?? '5432';
const dbPort = Number.parseInt(dbPortRaw, 10);
if (!Number.isInteger(dbPort) || dbPort <= 0 || dbPort > 65535) {
  throw new Error(`Invalid DB_PORT: "${dbPortRaw}"`);
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: dbPort,
  username: process.env.DB_USERNAME ?? 'auth_user',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'auth_db',
  entities: [Credential],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});

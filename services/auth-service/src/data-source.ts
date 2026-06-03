import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Credential } from './auth/entities/credential.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'auth_user',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'auth_db',
  entities: [Credential],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
});

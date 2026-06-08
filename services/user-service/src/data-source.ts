import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from './users/entities/user.entity';
import { Role } from './roles/entities/role.entity';
import { Permission } from './roles/entities/permission.entity';
import { UserOrgRole } from './roles/entities/user-org-role.entity';

const dbPortRaw = process.env.DB_PORT ?? '5432';
const dbPort = Number.parseInt(dbPortRaw, 10);
if (!Number.isInteger(dbPort) || dbPort <= 0 || dbPort > 65535) {
  throw new Error(`Invalid DB_PORT: "${dbPortRaw}"`);
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: dbPort,
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME ?? 'user_db',
  entities: [User, Role, Permission, UserOrgRole],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  // 'each' gives every migration its own transaction so ALTER TYPE ADD VALUE
  // can commit before the next migration uses the new enum value.
  migrationsTransactionMode: 'each',
  synchronize: false,
});

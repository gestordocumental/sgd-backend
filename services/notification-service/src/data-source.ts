import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Notification } from './notifications/entities/notification.entity';

const isDev = process.env.NODE_ENV !== 'production';

const requireEnv = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const dbPortRaw = process.env.DB_PORT ?? '5432';
const dbPort = Number.parseInt(dbPortRaw, 10);
if (!Number.isInteger(dbPort) || dbPort <= 0 || dbPort > 65535) {
  throw new Error(`Invalid DB_PORT: "${dbPortRaw}"`);
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host:     requireEnv('DB_HOST', isDev ? 'localhost' : undefined),
  port:     dbPort,
  username: requireEnv('DB_USERNAME', isDev ? 'postgres' : undefined),
  password: requireEnv('DB_PASSWORD', isDev ? 'postgres' : undefined),
  database: requireEnv('DB_NAME',     isDev ? 'notification_db' : undefined),
  entities: [Notification],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTransactionMode: 'each',
  synchronize: false,
  extra: { parseInt8: true },
});

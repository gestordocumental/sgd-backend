#!/bin/sh
set -e

echo ">>> Running database migrations..."
node -e "
const { AppDataSource } = require('./dist/data-source');
AppDataSource.initialize()
  .then(ds => ds.runMigrations({ transaction: 'each' }))
  .then(migrations => {
    console.log('Migrations applied:', migrations.length);
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
"

echo ">>> Starting application..."
exec node dist/main

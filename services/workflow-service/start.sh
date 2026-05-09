#!/bin/sh
set -e

echo ">>> Running database migrations..."
node -e "
require('reflect-metadata');
const { AppDataSource } = require('./dist/data-source');

AppDataSource.initialize()
  .then(ds => {
    console.log('Migration files found:', ds.migrations.length);
    return ds.runMigrations({ transaction: 'each' });
  })
  .then(migrations => {
    console.log('Migrations applied:', migrations.length);
    migrations.forEach(m => console.log(' -', m.name));
    process.exit(0);
  })
  .catch(err => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
"

echo ">>> Starting workflow-service..."
exec node dist/main

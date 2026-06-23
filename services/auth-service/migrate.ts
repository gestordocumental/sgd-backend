import 'dotenv/config';
import { AppDataSource } from './src/data-source';

const command = process.argv[2] ?? 'run';

AppDataSource.initialize()
  .then(async (ds) => {
    if (command === 'run') {
      const ran = await ds.runMigrations();
      console.log(`✓ ${ran.length} migration(s) applied`);
    } else if (command === 'revert') {
      await ds.undoLastMigration();
      console.log('✓ Last migration reverted');
    } else if (command === 'show') {
      await ds.showMigrations();
    }
    await ds.destroy();
    process.exit(0);
  })
  .catch((err: unknown) => {
    console.error('✗ Migration failed:', err);
    process.exit(1);
  });

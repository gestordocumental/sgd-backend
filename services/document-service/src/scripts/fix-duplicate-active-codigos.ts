import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * Diagnostic (and, with --fix, repair) tool for the exact condition that trips
 * TypologiesService.onModuleInit()'s syncIndexes() failure: two or more
 * non-deleted ACTIVE typologies sharing the same (orgId, datosDeclarados.codigo).
 * Mongo's autoIndex/syncIndexes() cannot build the partial unique index
 * (orgId, codigo) while such duplicates exist — it just fails silently under
 * autoIndex, or loudly (and is caught) under the explicit syncIndexes() call
 * in onModuleInit(). Once that happens, codigoUniquenessEnforced flips to
 * false and EVERY typology write with a codigo is blocked with a
 * ServiceUnavailableException (TYPOLOGY_UNIQUENESS_UNAVAILABLE) — including
 * brand new, otherwise-legitimate duplicate-codigo attempts that should
 * instead get the normal TYPOLOGY_CODE_ALREADY_EXISTS 409.
 *
 * These duplicates are historical: they could only have been created before
 * this session's uniqueness-check fixes closed the gaps that allowed them
 * (e.g. resolveDiscrepancy's ADOPT_EXTRACTED path used to skip the
 * duplicate-codigo check entirely). This script does not need to run on
 * every boot like backfill-review-cycle-enabled — it's a one-time repair for
 * data that predates those fixes, not an ongoing migration.
 *
 * Default mode is read-only: lists every (orgId, codigo) group with more
 * than one ACTIVE typology, so a human can look at them before anything is
 * touched.
 *
 * --fix additionally repairs each group by keeping the most recently updated
 * ACTIVE typology in that group as ACTIVE and setting every other member's
 * typologyStatus to ARCHIVED (deletedAt is left null — same convention
 * createNewVersion() already uses for a superseded version: still visible via
 * findHistory/GET, just no longer counted by the partial unique index or
 * shown in the default active list). Nothing is deleted or overwritten.
 *
 * Run with: npx ts-node src/scripts/fix-duplicate-active-codigos.ts [--fix]
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  const apply = process.argv.includes('--fix');

  await mongoose.connect(uri);

  try {
    const collection = mongoose.connection.collection('typologies');

    const groups = await collection
      .aggregate<{
        _id: { orgId: string; codigo: string };
        count: number;
        docs: { _id: mongoose.Types.ObjectId; nombre: string | null; version: string | null; updatedAt: Date; createdAt: Date }[];
      }>([
        {
          $match: {
            deletedAt: null,
            typologyStatus: 'ACTIVE',
            'datosDeclarados.codigo': { $ne: null },
          },
        },
        {
          $group: {
            _id: { orgId: '$orgId', codigo: '$datosDeclarados.codigo' },
            count: { $sum: 1 },
            docs: {
              $push: {
                _id: '$_id',
                nombre: '$datosDeclarados.nombre',
                version: '$datosDeclarados.version',
                updatedAt: '$updatedAt',
                createdAt: '$createdAt',
              },
            },
          },
        },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    if (groups.length === 0) {
      console.log(
        '✓ No duplicate ACTIVE typologies found for any (orgId, codigo). ' +
          'If syncIndexes() is still failing, the cause is something other than this — check the service logs / Sentry for the actual error.',
      );
      return;
    }

    console.log(`Found ${groups.length} (orgId, codigo) group(s) with duplicate ACTIVE typologies:\n`);

    for (const group of groups) {
      const sorted = [...group.docs].sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      const [keep, ...rest] = sorted;

      console.log(`orgId=${group._id.orgId} codigo="${group._id.codigo}" — ${group.count} active copies:`);
      for (const doc of sorted) {
        const role = doc._id.equals(keep._id) ? 'KEEP (most recently updated)' : 'would archive';
        console.log(
          `  - ${doc._id}  nombre="${doc.nombre}"  version="${doc.version}"  updatedAt=${new Date(doc.updatedAt).toISOString()}  [${role}]`,
        );
      }

      if (apply) {
        const idsToArchive = rest.map((d) => d._id);
        const result = await collection.updateMany(
          { _id: { $in: idsToArchive } },
          { $set: { typologyStatus: 'ARCHIVED' } },
        );
        console.log(`  → archived ${result.modifiedCount} of ${idsToArchive.length}`);
      }
      console.log('');
    }

    if (!apply) {
      console.log('Dry run only — nothing was changed. Re-run with --fix to archive all but the most recently updated copy in each group.');
    } else {
      console.log('✓ Repair complete. Restart document-service so onModuleInit() re-runs syncIndexes() and re-enables the uniqueness check.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('✗ fix-duplicate-active-codigos failed:', err);
    process.exit(1);
  });

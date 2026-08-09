import 'dotenv/config';
import mongoose from 'mongoose';

/**
 * One-time (idempotent) data migration for the org→typology review-cycle flag move.
 *
 * Context: `reviewCycleEnabled` used to live org-wide on `orgs.review_cycle_enabled`
 * (org-service, Postgres). That column was added by
 * `1775600000000-AddReviewCycleEnabled` with `DEFAULT true` and — verified by
 * auditing org-service's codebase — was never mapped on the `Org` entity nor
 * read/written by any controller, service, or DTO. So every org row has always held
 * the column's default, `true`; there is no per-org customization to lose.
 *
 * `1776500000000-DropReviewCycleEnabled` (org-service) drops that dead column.
 * Independently, the flag now lives per-typology here (`Typology.reviewCycleEnabled`,
 * schema default `false` — opt-in for typologies created from now on). Without this
 * backfill, every typology that existed before this rollout would silently flip from
 * "review cycle always ran" (the old org-wide default) to "review cycle never runs"
 * (the new per-typology default), the very regression this script prevents.
 *
 * Idempotent by construction: only documents that predate the `reviewCycleEnabled`
 * field (i.e. don't have it at all yet) are touched — any typology created after this
 * field existed on the schema already has it stored explicitly (Mongoose persists
 * schema defaults on insert), so it's excluded from the filter and left alone. Safe to
 * run on every boot (see start.sh) or by hand any number of times.
 *
 * Run manually with: npm run backfill:review-cycle-enabled
 * (or, compiled: node dist/scripts/backfill-review-cycle-enabled.js — what start.sh does on every boot)
 */
async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  await mongoose.connect(uri);

  try {
    const result = await mongoose.connection
      .collection('typologies')
      .updateMany({ reviewCycleEnabled: { $exists: false } }, { $set: { reviewCycleEnabled: true } });

    console.log(
      `✓ backfill-review-cycle-enabled: matched ${result.matchedCount}, modified ${result.modifiedCount}`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('✗ backfill-review-cycle-enabled failed:', err);
    process.exit(1);
  });

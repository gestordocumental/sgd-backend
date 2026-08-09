#!/bin/sh
set -e

echo ">>> Running review-cycle-enabled backfill..."
node dist/scripts/backfill-review-cycle-enabled.js || echo ">>> WARN: review-cycle-enabled backfill failed, continuing startup (idempotent — will retry on next boot)"

echo ">>> Starting document-service..."
exec node dist/main

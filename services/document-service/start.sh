#!/bin/sh
set -e

echo ">>> Running review-cycle-enabled backfill..."
node dist/scripts/backfill-review-cycle-enabled.js

echo ">>> Starting document-service..."
exec node dist/main

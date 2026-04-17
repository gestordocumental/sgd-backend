#!/bin/sh
set -e

echo ">>> Starting metadata-extractor-service..."
echo ">>> ENV CHECK: STORAGE_BUCKET=${STORAGE_BUCKET} STORAGE_ENDPOINT=${STORAGE_ENDPOINT} STORAGE_ACCESS_KEY=${STORAGE_ACCESS_KEY:+SET}"
exec node dist/main

#!/bin/sh
set -e

echo ">>> Starting metadata-extractor-service..."
exec node dist/main

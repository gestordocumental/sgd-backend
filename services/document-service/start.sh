#!/bin/sh
set -e

echo ">>> Starting document-service..."
exec node dist/main

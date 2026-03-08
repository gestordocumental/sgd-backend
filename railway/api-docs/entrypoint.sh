#!/bin/sh
# Genera .htpasswd en runtime desde variables de entorno.
# El secreto nunca queda grabado en las capas de la imagen.
set -e

if [ -z "$DOCS_PASSWORD" ]; then
  echo "ERROR: DOCS_PASSWORD env var is required" >&2
  exit 1
fi

printf '%s\n' "$DOCS_PASSWORD" | htpasswd -ci /tmp/.htpasswd "${DOCS_USER:-sgd}"

exec nginx -g "daemon off;"

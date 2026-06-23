#!/bin/sh
# Sustituye variables de entorno en el template antes de que Kong lo cargue.
# Soporta dos modos:
#   - Local (default): usa kong.local.yaml  (orígenes CORS hardcodeados a localhost)
#   - Producción:      usa kong.prod.yaml   (requiere KONG_CORS_ORIGIN_1, KONG_CORS_ORIGIN_2
#                                            y *_SERVICE_URL por cada microservicio)
#
# Selección del template:
#   KONG_CONFIG_TEMPLATE=/etc/kong/kong.prod.yaml   → producción
#   (sin variable)                                   → kong.local.yaml (dev)
set -e

TEMPLATE="${KONG_CONFIG_TEMPLATE:-/etc/kong/kong.template.yaml}"

# Lista explícita de variables a sustituir para evitar que `envsubst` expanda
# variables de shell internas de Kong que no deben tocarse.
VARS='${KONG_JWT_SECRET}
${KONG_CORS_ORIGIN_1}
${KONG_CORS_ORIGIN_2}
${AUTH_SERVICE_URL}
${USER_SERVICE_URL}
${ORG_SERVICE_URL}
${DOCUMENT_SERVICE_URL}
${METADATA_SERVICE_URL}
${WORKFLOW_SERVICE_URL}
${NOTIFICATION_SERVICE_URL}
${AUDIT_SERVICE_URL}'

if command -v envsubst >/dev/null 2>&1; then
  envsubst "$VARS" < "$TEMPLATE" > /tmp/kong.yaml
else
  cp "$TEMPLATE" /tmp/kong.yaml

  escape_sed_replacement() {
    printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
  }

  for name in \
    KONG_JWT_SECRET \
    KONG_CORS_ORIGIN_1 \
    KONG_CORS_ORIGIN_2 \
    AUTH_SERVICE_URL \
    USER_SERVICE_URL \
    ORG_SERVICE_URL \
    DOCUMENT_SERVICE_URL \
    METADATA_SERVICE_URL \
    WORKFLOW_SERVICE_URL \
    NOTIFICATION_SERVICE_URL \
    AUDIT_SERVICE_URL
  do
    value="$(eval "printf '%s' \"\${$name:-}\"")"
    escaped="$(escape_sed_replacement "$value")"
    sed -i "s|\${$name}|$escaped|g" /tmp/kong.yaml
  done
fi

export KONG_DECLARATIVE_CONFIG=/tmp/kong.yaml
exec /docker-entrypoint.sh "$@"

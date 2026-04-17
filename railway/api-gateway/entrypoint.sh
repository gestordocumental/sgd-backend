#!/bin/sh
# Sustituye variables de entorno en kong.yaml antes de arrancar Kong.
# Railway no tiene ConfigMaps, las variables se inyectan como env vars.

set -e

# Railway inyecta PORT. Kong debe escuchar en ese puerto.
# Si PORT no está seteado (local), usar 8000 como fallback.
export KONG_PROXY_LISTEN="0.0.0.0:${PORT:-8000}"

# sed reemplaza ${VARIABLE} en la plantilla con el valor de la env var
sed \
  -e "s|\${KONG_JWT_SECRET}|${KONG_JWT_SECRET}|g" \
  -e "s|\${FRONTEND_URL}|${FRONTEND_URL}|g" \
  /etc/kong/kong.yaml.template > /etc/kong/kong.yaml

export KONG_DECLARATIVE_CONFIG=/etc/kong/kong.yaml

exec /docker-entrypoint.sh kong docker-start

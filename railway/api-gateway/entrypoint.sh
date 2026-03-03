#!/bin/sh
# Sustituye variables de entorno en kong.yaml antes de arrancar Kong.
# Railway no tiene ConfigMaps, las variables se inyectan como env vars.

set -e

# envsubst reemplaza ${VARIABLE} en la plantilla con el valor de la env var
envsubst '${KONG_JWT_SECRET} ${FRONTEND_URL}' \
  < /etc/kong/kong.yaml.template \
  > /etc/kong/kong.yaml

export KONG_DECLARATIVE_CONFIG=/etc/kong/kong.yaml

exec /docker-entrypoint.sh kong docker-start

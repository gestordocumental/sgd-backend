#!/bin/sh
# Sustituye ${KONG_JWT_SECRET} en el template antes de que Kong lo cargue.
# _transform: true en el YAML de Kong no hace sustitución de variables de entorno.
set -e
sed "s|\${KONG_JWT_SECRET}|${KONG_JWT_SECRET}|g" \
  /etc/kong/kong.template.yaml > /tmp/kong.yaml
export KONG_DECLARATIVE_CONFIG=/tmp/kong.yaml
exec /docker-entrypoint.sh "$@"

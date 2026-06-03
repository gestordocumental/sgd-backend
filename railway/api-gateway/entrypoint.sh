#!/bin/sh
# Sustituye variables de entorno en kong.yaml antes de arrancar Kong.
# Railway no tiene ConfigMaps, las variables se inyectan como env vars.

set -eu

: "${KONG_JWT_SECRET:?KONG_JWT_SECRET is required}"
: "${FRONTEND_URL:?FRONTEND_URL is required}"
: "${AUTH_SENSITIVE_RATE_LIMIT:?AUTH_SENSITIVE_RATE_LIMIT is required}"
: "${AUTH_SESSION_RATE_LIMIT:?AUTH_SESSION_RATE_LIMIT is required}"

# Railway inyecta PORT. Kong debe escuchar en ese puerto.
# Si PORT no está seteado (local), usar 8000 como fallback.
export KONG_PROXY_LISTEN="0.0.0.0:${PORT:-8000}"

# escape_sed_replacement escapa los caracteres '&', '|' y '\' para que la cadena pueda usarse como parte de reemplazo en comandos sed.
escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[&|\\]/\\&/g'
}

jwt_secret_escaped="$(escape_sed_replacement "${KONG_JWT_SECRET}")"
frontend_url_escaped="$(escape_sed_replacement "${FRONTEND_URL}")"

sed \
  -e "s|\${KONG_JWT_SECRET}|${jwt_secret_escaped}|g" \
  -e "s|\${FRONTEND_URL}|${frontend_url_escaped}|g" \
  -e "s|\${AUTH_SENSITIVE_RATE_LIMIT}|${AUTH_SENSITIVE_RATE_LIMIT}|g" \
  -e "s|\${AUTH_SESSION_RATE_LIMIT}|${AUTH_SESSION_RATE_LIMIT}|g" \
  /etc/kong/kong.yaml.template > /etc/kong/kong.yaml

export KONG_DECLARATIVE_CONFIG=/etc/kong/kong.yaml

exec /docker-entrypoint.sh kong docker-start

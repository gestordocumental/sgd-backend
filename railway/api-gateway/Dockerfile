# Kong API Gateway — imagen para Railway
# La configuración declarativa se monta en la imagen.
# Las variables ${KONG_JWT_SECRET} y ${FRONTEND_URL} se resuelven
# en runtime via KONG_DECLARATIVE_CONFIG_STRING (ver entrypoint.sh).

FROM kong:3.4-ubuntu

USER root

COPY kong.yaml /etc/kong/kong.yaml.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV KONG_DATABASE=off
# Railway inyecta PORT automáticamente. Kong lo usa para el proxy listener.
# Si PORT no viene de Railway, usa 8000 como fallback.
ENV KONG_PROXY_LISTEN=0.0.0.0:8000
# Admin solo accesible internamente (nunca exponer en prod)
ENV KONG_ADMIN_LISTEN=127.0.0.1:8001
ENV KONG_NGINX_WORKER_PROCESSES=1
ENV KONG_PROXY_ACCESS_LOG=/dev/stdout
ENV KONG_PROXY_ERROR_LOG=/dev/stderr

EXPOSE 8000

USER kong

ENTRYPOINT ["/entrypoint.sh"]

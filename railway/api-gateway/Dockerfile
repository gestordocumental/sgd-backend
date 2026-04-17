# Kong API Gateway — imagen para Railway
# La configuración declarativa se monta en la imagen.
# Las variables ${KONG_JWT_SECRET} y ${FRONTEND_URL} se resuelven
# en runtime via envsubst (ver entrypoint.sh).

FROM kong:3.4-alpine

USER root

# envsubst viene incluido en alpine via gettext (ya presente en la imagen base)
RUN apk add --no-cache gettext

COPY kong.yaml /etc/kong/kong.yaml.template
COPY entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh && \
    chown kong:kong /etc/kong/kong.yaml.template /entrypoint.sh && \
    chmod 755 /etc/kong

ENV KONG_DATABASE=off
# Railway inyecta PORT automáticamente. Kong lo usa para el proxy listener.
# Si PORT no viene de Railway, usa 8000 como fallback.
ENV KONG_PROXY_LISTEN=0.0.0.0:8000
ENV KONG_ADMIN_LISTEN=127.0.0.1:8001
ENV KONG_NGINX_WORKER_PROCESSES=1
ENV KONG_PROXY_ACCESS_LOG=/dev/stdout
ENV KONG_PROXY_ERROR_LOG=/dev/stderr

EXPOSE 8000

USER kong

ENTRYPOINT ["/entrypoint.sh"]

# Kong API Gateway — imagen para Railway
# La configuración declarativa se monta en la imagen.
# Las variables ${KONG_JWT_SECRET} y ${FRONTEND_URL} se resuelven
# en runtime via envsubst (ver entrypoint.sh).

FROM kong:3.4-ubuntu

USER root

# gettext-base provee envsubst (no incluido en la imagen base de Kong)
# Necesario para sustituir variables de entorno en kong.yaml al arrancar
RUN apt-get update && \
    apt-get install -y --no-install-recommends gettext-base && \
    rm -rf /var/lib/apt/lists/*

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

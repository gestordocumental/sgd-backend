FROM prom/prometheus:v2.51.0

COPY prometheus.yml /etc/prometheus/prometheus.yml.template

# envsubst para inyectar ${ENVIRONMENT} en el config al arrancar
USER root
RUN apk add --no-cache gettext

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 9090

ENTRYPOINT ["/entrypoint.sh"]

FROM postgres:15-alpine

COPY init-databases.sh /init-databases.sh
RUN chmod +x /init-databases.sh

# Sobreescribir el entrypoint de postgres para ejecutar solo el script
ENTRYPOINT ["/init-databases.sh"]

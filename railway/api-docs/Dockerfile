FROM nginx:alpine

# Install apache2-utils for htpasswd
RUN apk add --no-cache apache2-utils

# Allow nginx user to write to required runtime directories
RUN chown -R nginx:nginx /var/cache/nginx /var/log/nginx \
    && touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

# Copy generated docs
COPY railway/api-docs/public/ /usr/share/nginx/html/

# Copy nginx config with basic auth
COPY railway/api-docs/nginx.conf /etc/nginx/conf.d/default.conf

# Entrypoint generates .htpasswd at runtime from env vars (DOCS_USER, DOCS_PASSWORD).
# Secrets never touch image layers or build metadata.
COPY railway/api-docs/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

USER nginx

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]

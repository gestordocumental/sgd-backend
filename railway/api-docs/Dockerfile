FROM nginx:alpine

# Install apache2-utils for htpasswd
RUN apk add --no-cache apache2-utils

# Copy generated docs
COPY public/ /usr/share/nginx/html/

# Copy nginx config with basic auth
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Entrypoint generates .htpasswd at runtime from env vars (DOCS_USER, DOCS_PASSWORD).
# Secrets never touch image layers or build metadata.
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

ENTRYPOINT ["/entrypoint.sh"]

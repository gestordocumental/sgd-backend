FROM nginx:alpine

# Install apache2-utils for htpasswd
RUN apk add --no-cache apache2-utils

# Copy generated docs
COPY public/ /usr/share/nginx/html/

# Copy nginx config with basic auth
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Generate basic auth credentials at build time from build args
ARG DOCS_USER=sgd
ARG DOCS_PASSWORD=changeme
RUN htpasswd -cb /etc/nginx/.htpasswd "$DOCS_USER" "$DOCS_PASSWORD"

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

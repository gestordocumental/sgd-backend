#!/bin/sh
set -e

envsubst '${ENVIRONMENT}' \
  < /etc/prometheus/prometheus.yml.template \
  > /etc/prometheus/prometheus.yml

exec /bin/prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --storage.tsdb.path=/prometheus \
  --storage.tsdb.retention.time=15d \
  --web.enable-lifecycle

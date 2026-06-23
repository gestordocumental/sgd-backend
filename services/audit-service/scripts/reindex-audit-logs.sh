#!/usr/bin/env bash
# reindex-audit-logs.sh
#
# Recreates the audit-logs Elasticsearch index with the explicit mapping defined
# in AuditService.ensureIndex(). Run this against any environment where the index
# was auto-created with dynamic mapping (the RC-3 incident pattern).
#
# !! MAINTENANCE WINDOW REQUIRED !!
#
#   Steps 7-8 delete the original index and recreate it.  During that window
#   (typically < 1 s) any write from audit-service will fail with
#   index_not_found_exception — or, if Elasticsearch auto-creation is enabled,
#   will recreate the index with dynamic mapping, reintroducing the RC-3 bug.
#
#   Before running this script you MUST:
#     1. Scale audit-service to 0 replicas (Railway: pause the service).
#     2. Confirm you have read this warning by setting MAINTENANCE_CONFIRMED=yes.
#     3. After the script completes, scale audit-service back up.
#
# Usage:
#   ELASTICSEARCH_URL=https://... \
#   ELASTICSEARCH_USERNAME=elastic \
#   ELASTICSEARCH_PASSWORD=secret \
#   MAINTENANCE_CONFIRMED=yes \
#   bash reindex-audit-logs.sh
#
# The script is idempotent: if the mapping is already correct it exits cleanly.
# All data is preserved via a temp index before the original is dropped.

set -euo pipefail

ES_URL="${ELASTICSEARCH_URL:?ELASTICSEARCH_URL is required}"
ES_USER="${ELASTICSEARCH_USERNAME:?ELASTICSEARCH_USERNAME is required}"
ES_PASS="${ELASTICSEARCH_PASSWORD:?ELASTICSEARCH_PASSWORD is required}"

if [ "${MAINTENANCE_CONFIRMED:-}" != "yes" ]; then
  echo "[ERROR] This script requires a maintenance window. Scale audit-service to 0 replicas first," >&2
  echo "        then re-run with MAINTENANCE_CONFIRMED=yes." >&2
  exit 1
fi

command -v python3 >/dev/null 2>&1 || { echo "[ERROR] python3 is required but not installed" >&2; exit 1; }
command -v curl    >/dev/null 2>&1 || { echo "[ERROR] curl is required but not installed"    >&2; exit 1; }

INDEX="audit-logs"
TEMP_INDEX="audit-logs-reindex-tmp"

# Mapping must stay in sync with AuditService.ensureIndex() in audit.service.ts
read -r -d '' INDEX_BODY <<'MAPPING' || true
{
  "mappings": {
    "properties": {
      "service":       { "type": "keyword" },
      "actorId":       { "type": "keyword" },
      "orgId":         { "type": "keyword" },
      "action":        { "type": "keyword" },
      "resourceType":  { "type": "keyword" },
      "resourceId":    { "type": "keyword" },
      "resourceName":  { "type": "keyword" },
      "correlationId": { "type": "text", "fields": { "keyword": { "type": "keyword", "ignore_above": 256 } } },
      "ip":            { "type": "keyword" },
      "metadata":      { "type": "object", "enabled": false },
      "timestamp":     { "type": "date" },
      "indexedAt":     { "type": "date" }
    }
  },
  "settings": {
    "number_of_shards":   1,
    "number_of_replicas": 0
  }
}
MAPPING

NETRC_FILE=$(mktemp)
trap 'rm -f "${NETRC_FILE}"' EXIT
chmod 600 "${NETRC_FILE}"
ES_HOST=$(echo "${ES_URL}" | sed -E 's|https?://([^/]+).*|\1|')
printf 'machine %s\nlogin %s\npassword %s\n' "${ES_HOST}" "${ES_USER}" "${ES_PASS}" > "${NETRC_FILE}"
AUTH=(--netrc-file "${NETRC_FILE}")

# ── helpers ────────────────────────────────────────────────────────────────────

es() {
  curl -fsSL "${AUTH[@]}" -H "Content-Type: application/json" "$@"
}

log()  { echo "[$(date -u +%H:%M:%S)] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

# ── 1. check if index exists ───────────────────────────────────────────────────

log "Checking index '${INDEX}'..."
STATUS=$(curl -o /dev/null -w "%{http_code}" -sSL "${AUTH[@]}" "${ES_URL}/${INDEX}")

if [ "$STATUS" = "404" ]; then
  log "Index does not exist — creating with correct mapping."
  es -X PUT "${ES_URL}/${INDEX}" -d "${INDEX_BODY}"
  log "Done — index created."
  exit 0
fi

# ── 2. check if correlationId already has the correct text+keyword mapping ─────

CORR_TYPE=$(es "${ES_URL}/${INDEX}/_mapping" | \
  python3 -c "import sys,json; m=json.load(sys.stdin); \
  print(m.get('${INDEX}',{}).get('mappings',{}).get('properties',{}).get('correlationId',{}).get('type','missing'))")

if [ "$CORR_TYPE" = "text" ]; then
  log "Mapping is already correct (correlationId.type=text). Nothing to do."
  exit 0
fi

log "Detected incorrect mapping (correlationId.type=${CORR_TYPE}). Starting reindex..."

# ── 3. count documents in source ───────────────────────────────────────────────

DOC_COUNT=$(es "${ES_URL}/${INDEX}/_count" | python3 -c "import sys,json; print(json.load(sys.stdin)['count'])")
log "Documents to migrate: ${DOC_COUNT}"

# ── 4. delete temp index if it exists from a previous failed run ───────────────

TEMP_STATUS=$(curl -o /dev/null -w "%{http_code}" -sSL "${AUTH[@]}" "${ES_URL}/${TEMP_INDEX}")
if [ "$TEMP_STATUS" != "404" ]; then
  log "Removing stale temp index '${TEMP_INDEX}'..."
  es -X DELETE "${ES_URL}/${TEMP_INDEX}" > /dev/null
fi

# ── 5. create temp index with correct mapping ──────────────────────────────────

log "Creating temp index '${TEMP_INDEX}' with correct mapping..."
es -X PUT "${ES_URL}/${TEMP_INDEX}" -d "${INDEX_BODY}" > /dev/null

# ── 6. reindex source → temp ───────────────────────────────────────────────────

log "Reindexing '${INDEX}' → '${TEMP_INDEX}'..."
TASK=$(es -X POST "${ES_URL}/_reindex?wait_for_completion=true" -d "{
  \"source\": { \"index\": \"${INDEX}\" },
  \"dest\":   { \"index\": \"${TEMP_INDEX}\", \"op_type\": \"create\" }
}")

MIGRATED=$(echo "$TASK" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('total',0))")
FAILURES=$(echo "$TASK" | python3 -c "import sys,json; r=json.load(sys.stdin); print(len(r.get('failures',[])))")
[[ "$MIGRATED" =~ ^[0-9]+$ ]] || fail "Failed to parse reindex result (MIGRATED='${MIGRATED}')"
[[ "$FAILURES" =~ ^[0-9]+$ ]] || fail "Failed to parse reindex result (FAILURES='${FAILURES}')"

log "Reindex completed: ${MIGRATED} documents moved, ${FAILURES} failures."
[ "$FAILURES" -gt 0 ] && fail "Reindex had ${FAILURES} failures — aborting. Original index untouched."

# ── 7. delete original index ───────────────────────────────────────────────────

log "MAINTENANCE WINDOW OPEN — audit-service must be stopped. Deleting '${INDEX}'..."
es -X DELETE "${ES_URL}/${INDEX}" > /dev/null

# ── 8. create original index with correct mapping ──────────────────────────────

log "Recreating '${INDEX}' with correct mapping..."
es -X PUT "${ES_URL}/${INDEX}" -d "${INDEX_BODY}" > /dev/null
log "MAINTENANCE WINDOW CLOSED — '${INDEX}' exists again with correct mapping. audit-service can be restarted."

# ── 9. reindex temp → original ─────────────────────────────────────────────────

log "Reindexing '${TEMP_INDEX}' → '${INDEX}'..."
TASK2=$(es -X POST "${ES_URL}/_reindex?wait_for_completion=true" -d "{
  \"source\": { \"index\": \"${TEMP_INDEX}\" },
  \"dest\":   { \"index\": \"${INDEX}\", \"op_type\": \"create\" }
}")

FINAL=$(echo "$TASK2" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('total',0))")
FAILS2=$(echo "$TASK2" | python3 -c "import sys,json; r=json.load(sys.stdin); print(len(r.get('failures',[])))")
[[ "$FINAL"  =~ ^[0-9]+$ ]] || fail "Failed to parse reindex result (FINAL='${FINAL}')"
[[ "$FAILS2" =~ ^[0-9]+$ ]] || fail "Failed to parse reindex result (FAILS2='${FAILS2}')"

[ "$FAILS2" -gt 0 ] && fail "${FAILS2} failures restoring to '${INDEX}'. Data is intact in '${TEMP_INDEX}'."

# ── 10. cleanup ────────────────────────────────────────────────────────────────

log "Deleting temp index '${TEMP_INDEX}'..."
es -X DELETE "${ES_URL}/${TEMP_INDEX}" > /dev/null

if [ "$FINAL" -ne "$DOC_COUNT" ]; then
  log "Warning: Document count changed during reindex (initial: ${DOC_COUNT}, final: ${FINAL}). This may indicate ongoing writes during migration."
fi
log "Done. ${FINAL} documents migrated to '${INDEX}' with correct mapping."

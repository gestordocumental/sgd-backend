#!/usr/bin/env bash
# deploy-services.sh — Despliega todos los microservicios SGD en orden de dependencias.
#
# Uso:
#   ./helm/deploy-services.sh [--namespace <ns>] [--registry <registry>] [--tag <tag>] [--dry-run]
#
# Flags:
#   --namespace <ns>       Namespace destino (default: gestor-documental)
#   --registry <registry>  Image registry (default: ghcr.io/your-org)
#                          Ejemplo: --registry ghcr.io/real-org
#   --tag <tag>            Image tag para todos los servicios (default: usa Chart.AppVersion)
#                          Ejemplo: --tag sha-abc1234
#   --dry-run              Solo muestra los comandos sin ejecutarlos
#
# Pre-requisitos:
#   - kubectl apuntando al cluster correcto
#   - Namespace y RBAC ya creados: kubectl apply -f k8s/namespaces/
#   - Infra en sgd-infra ya desplegada (Paso 3 de kind-values.yaml)
#   - Secrets y ConfigMaps ya aplicados:
#       kubectl apply -f k8s/secrets/ -n <namespace>
#       kubectl apply -f k8s/configmaps/ -n <namespace>

set -euo pipefail

# ── Parámetros ────────────────────────────────────────────────────────────────

NAMESPACE="gestor-documental"
REGISTRY=""
TAG=""
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --registry)  REGISTRY="$2";  shift 2 ;;
    --tag)       TAG="$2";        shift 2 ;;
    --dry-run)   DRY_RUN=true;   shift   ;;
    *) echo "Unknown flag: $1"; exit 1   ;;
  esac
done

CHART="helm/charts/sgd-service"
TIMEOUT="5m"

# Build --set overrides for registry and tag if provided
EXTRA_SETS=()
[[ -n "$REGISTRY" ]] && EXTRA_SETS+=(--set "imageRegistry=${REGISTRY}")
[[ -n "$TAG" ]]      && EXTRA_SETS+=(--set "image.tag=${TAG}")

# Capas de despliegue (orden de dependencias):
#   Capa 1: auth-service         — base de autenticación
#   Capa 2: user-service         — depende de auth-service (circular tolerada por circuit-breaker)
#   Capa 3: org-service          — depende de user-service
#   Capa 4: servicios de dominio — dependen de capas anteriores
declare -a LAYER_1=(auth-service)
declare -a LAYER_2=(user-service)
declare -a LAYER_3=(org-service)
declare -a LAYER_4=(document-service workflow-service notification-service audit-service metadata-extractor-service)

ALL_SERVICES=("${LAYER_1[@]}" "${LAYER_2[@]}" "${LAYER_3[@]}" "${LAYER_4[@]}")

# ── Helpers ───────────────────────────────────────────────────────────────────

log()  { echo "[deploy] $*"; }
die()  { echo "[ERROR] $*" >&2; exit 1; }

run() {
  if $DRY_RUN; then
    echo "[dry-run] $*"
  else
    "$@"
  fi
}

# ── Validar herramientas ──────────────────────────────────────────────────────

command -v kubectl >/dev/null 2>&1 || die "kubectl no encontrado. Instálalo primero."
command -v helm    >/dev/null 2>&1 || die "helm no encontrado. Instálalo primero."

# ── Pre-flight: validar Secrets y ConfigMaps ──────────────────────────────────

log "Validating pre-requisites in namespace '$NAMESPACE'..."

MISSING=0
for svc in "${ALL_SERVICES[@]}"; do
  if ! kubectl get secret "${svc}-secret" -n "$NAMESPACE" &>/dev/null; then
    echo "  MISSING Secret:    ${svc}-secret"
    MISSING=1
  fi
  if ! kubectl get configmap "${svc}-config" -n "$NAMESPACE" &>/dev/null; then
    echo "  MISSING ConfigMap: ${svc}-config"
    MISSING=1
  fi
done

if [[ $MISSING -eq 1 ]]; then
  die "One or more Secrets/ConfigMaps are missing. Apply them first:
    kubectl apply -f k8s/secrets/    -n $NAMESPACE
    kubectl apply -f k8s/configmaps/ -n $NAMESPACE"
fi

log "Pre-requisites OK."

# ── Función de instalación ────────────────────────────────────────────────────

install_layer() {
  local layer_name="$1"; shift
  local services=("$@")

  log "── $layer_name ──────────────────────────────"
  for svc in "${services[@]}"; do
    log "Installing $svc..."
    run helm upgrade --install "$svc" "$CHART" \
      --namespace "$NAMESPACE" \
      --values "helm/values/${svc}-values.yaml" \
      "${EXTRA_SETS[@]+"${EXTRA_SETS[@]}"}" \
      --wait \
      --timeout "$TIMEOUT"
    log "$svc ready."
  done
}

# ── Despliegue por capas ──────────────────────────────────────────────────────

install_layer "Capa 1: auth-service"  "${LAYER_1[@]}"
install_layer "Capa 2: user-service"  "${LAYER_2[@]}"
install_layer "Capa 3: org-service"   "${LAYER_3[@]}"
install_layer "Capa 4: domain services" "${LAYER_4[@]}"

log "All services deployed successfully."

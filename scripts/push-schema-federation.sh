#!/usr/bin/env bash
# Wrapper: push SurrealKit schema through Apollo + WunderGraph from cloud-agent.
# Source of truth lives in surreal-graphql-gateway (.px/database).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLOUD_AGENT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Resolve gateway root from .px/pointers.yaml if possible
GW_DEFAULT="$CLOUD_AGENT_ROOT/../../02-products/surreal-graphql-gateway"
if [[ -f "$CLOUD_AGENT_ROOT/.px/pointers.yaml" ]]; then
  GW_FROM_PTR="$(awk '/^surreal_graphql_gateway:/{f=1} f&&/root:/{print $2; exit}' "$CLOUD_AGENT_ROOT/.px/pointers.yaml" || true)"
  if [[ -n "${GW_FROM_PTR:-}" ]]; then
    if [[ "$GW_FROM_PTR" = /* ]]; then
      GW_DEFAULT="$GW_FROM_PTR"
    else
      GW_DEFAULT="$CLOUD_AGENT_ROOT/$GW_FROM_PTR"
    fi
  fi
fi

GW_ROOT="${SURREAL_GRAPHQL_GATEWAY_ROOT:-$GW_DEFAULT}"
GW_ROOT="$(cd "$GW_ROOT" 2>/dev/null && pwd)" || {
  echo "Gateway not found at $GW_DEFAULT" >&2
  echo "Set SURREAL_GRAPHQL_GATEWAY_ROOT or fix .px/pointers.yaml surreal_graphql_gateway.root" >&2
  exit 1
}

echo "cloud-agent → federation push via $GW_ROOT"
echo "  (ontologyEditing gate: $(python3 -c "import json;print(json.load(open('$CLOUD_AGENT_ROOT/.px/config.json')).get('ontologyEditing'))" 2>/dev/null || echo '?'))"

if [[ -f "$CLOUD_AGENT_ROOT/.px/config.json" ]]; then
  OE="$(python3 -c "import json;print(json.load(open('$CLOUD_AGENT_ROOT/.px/config.json')).get('ontologyEditing', False))" 2>/dev/null || echo False)"
  if [[ "$OE" != "True" && "$OE" != "true" ]]; then
    echo "WARNING: ontologyEditing is not true in cloud-agent/.px/config.json" >&2
  fi
fi

export PX_GROK_BUNDLE="${PX_GROK_BUNDLE:-$CLOUD_AGENT_ROOT/.grok-bundle}"
export PATH="${PX_GROK_BUNDLE}/bin:${PATH}"

exec bash "$GW_ROOT/scripts/push-schema-federation.sh" "$@"

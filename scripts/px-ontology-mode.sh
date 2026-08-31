#!/usr/bin/env bash
# px-ontology-mode.sh — enforce vs edit gates in .px/config.json
#
# Usage:
#   bash scripts/px-ontology-mode.sh enforce on|off|status|toggle
#   bash scripts/px-ontology-mode.sh edit on|off|status|toggle
#   bash scripts/px-ontology-mode.sh status
#
# Env overrides (read-time):
#   PX_ONTOLOGY_ENFORCE=0|1
#   PX_ONTOLOGY_EDIT=0|1
set -euo pipefail

ROOT="${PX_MODE_ROOT:-$PWD}"
if [[ ! -d "$ROOT/.px" ]]; then
  # prefer cloud-agent when invoked from elsewhere
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  CAND="$(cd "$SCRIPT_DIR/.." && pwd)"
  if [[ -d "$CAND/.px" ]]; then
    ROOT="$CAND"
  fi
fi
CONFIG="$ROOT/.px/config.json"
mkdir -p "$(dirname "$CONFIG")"

if [[ ! -f "$CONFIG" ]]; then
  printf '{\n  "ontologyEditing": false,\n  "ontologyEnforcement": true,\n  "updatedAt": "%s"\n}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" >"$CONFIG"
fi

read_flags() {
  node -e "
const fs=require('fs');
const p=process.argv[1];
let c={};
try { c=JSON.parse(fs.readFileSync(p,'utf8')); } catch {}
const edit = process.env.PX_ONTOLOGY_EDIT === '1' || process.env.PX_ONTOLOGY_EDIT === 'true'
  ? true
  : process.env.PX_ONTOLOGY_EDIT === '0' || process.env.PX_ONTOLOGY_EDIT === 'false'
    ? false
    : !!c.ontologyEditing;
const enfEnv = process.env.PX_ONTOLOGY_ENFORCE;
const enf = enfEnv === '1' || enfEnv === 'true' ? true
  : enfEnv === '0' || enfEnv === 'false' ? false
  : (c.ontologyEnforcement === undefined ? true : !!c.ontologyEnforcement);
process.stdout.write(JSON.stringify({
  ontologyEditing: edit,
  ontologyEnforcement: enf,
  updatedAt: c.updatedAt || null,
  path: p
}));
" "$CONFIG"
}

write_flag() {
  local key="$1" val="$2"
  node -e "
const fs=require('fs');
const p=process.argv[1];
const key=process.argv[2];
const val=process.argv[3]==='true';
let c={};
try { c=JSON.parse(fs.readFileSync(p,'utf8')); } catch {}
if (c.ontologyEditing === undefined) c.ontologyEditing = false;
if (c.ontologyEnforcement === undefined) c.ontologyEnforcement = true;
c[key] = val;
c.updatedAt = new Date().toISOString();
fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
" "$CONFIG" "$key" "$val"
}

print_status() {
  local j
  j="$(read_flags)"
  echo "Ontology status"
  echo "  config: $CONFIG"
  echo "$j" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
console.log('  ontologyEnforcement:', d.ontologyEnforcement ? 'ON' : 'OFF',
  '(pre/post SHACL + sandboxed MCP)');
console.log('  ontologyEditing:    ', d.ontologyEditing ? 'ON' : 'OFF',
  '(schema/DDL mutations + suggestions)');
if (d.updatedAt) console.log('  updatedAt:', d.updatedAt);
"
}

MODE="${1:-status}"
ACTION="${2:-}"

case "$MODE" in
  status)
    print_status
    exit 0
    ;;
  enforce|enforcement|ontology)
    # /ontology on|off → enforce
    case "${ACTION:-status}" in
      on|true|1) write_flag ontologyEnforcement true; echo "Ontology enforcement: ON" ;;
      off|false|0) write_flag ontologyEnforcement false; echo "Ontology enforcement: OFF" ;;
      toggle)
        cur="$(read_flags | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.ontologyEnforcement?'true':'false')")"
        if [[ "$cur" == "true" ]]; then write_flag ontologyEnforcement false; echo "Ontology enforcement: OFF"
        else write_flag ontologyEnforcement true; echo "Ontology enforcement: ON"; fi
        ;;
      status) print_status; exit 0 ;;
      *) echo "usage: $0 enforce on|off|status|toggle" >&2; exit 2 ;;
    esac
    print_status
    ;;
  edit|editing)
    case "${ACTION:-toggle}" in
      on|true|1) write_flag ontologyEditing true; echo "Ontology editing: ON" ;;
      off|false|0) write_flag ontologyEditing false; echo "Ontology editing: OFF" ;;
      toggle)
        cur="$(read_flags | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.ontologyEditing?'true':'false')")"
        if [[ "$cur" == "true" ]]; then write_flag ontologyEditing false; echo "Ontology editing: OFF"
        else write_flag ontologyEditing true; echo "Ontology editing: ON"; fi
        ;;
      status) print_status; exit 0 ;;
      *) echo "usage: $0 edit on|off|status|toggle" >&2; exit 2 ;;
    esac
    print_status
    ;;
  on)
    # convenience: ontology on → enforce on
    write_flag ontologyEnforcement true
    echo "Ontology enforcement: ON"
    print_status
    ;;
  off)
    write_flag ontologyEnforcement false
    echo "Ontology enforcement: OFF"
    print_status
    ;;
  *)
    echo "usage: $0 {enforce|edit|status|on|off} [on|off|status|toggle]" >&2
    exit 2
    ;;
esac
exit 0

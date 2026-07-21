# Verification Specifications (cloud-agent)

Formal verification for the cloud-agent platform: Daytona sandbox lifecycle, Midspiral MCP tools, dual-account GitHub token isolation, and PR validation gates.

Layout mirrors assistant-ui’s `config/verification/` (tooling patterns only — not chat-protocol specs).

## Directory Structure

```
config/verification/
├── quint/           # Executable FSM (sandbox lifecycle)
├── alloy/           # Relational models (MCP tools, business rules)
├── dafny/           # Program verification (validation gate, tokens)
├── tla/             # Optional TLA+ stubs
├── lean/            # Optional Lean 4 stubs
└── lemma/           # Optional Lemma stubs
```

## Specifications

### Quint (`quint/`)
- `sandbox-lifecycle.qnt` — create → bootstrap → exec → destroy; no use-after-destroy

### Alloy (`alloy/`)
- `MidspiralTools.als` — acyclic tool deps; Daytona ops SDK-only (no `provider.sh`)
- `BusinessRules.als` — rule structure + non-contradictory conditions

### Dafny (`dafny/`)
- `ValidationGate.dfy` — PR create requires validation pass
- `TokenIsolation.dfy` — BrightforestX vs personal tokens never cross-contaminate

### Optional stubs
- `tla/`, `lean/`, `lemma/` — README pointers only until specs are added

## Running locally

```bash
# From cloud-agent repo root
./scripts/verify-local.sh
./scripts/verify-local.sh --check-tools

# One-time tool install
./scripts/setup-verification-tools.sh

# npm shortcuts
npm run verify:quint
npm run verify:dafny
npm run verify:alloy
npm run verify:all
```

### Individual tools

```bash
# Quint (~0.32)
quint typecheck config/verification/quint/sandbox-lifecycle.qnt
# or
npx --yes @informalsystems/quint@0.32.0 typecheck config/verification/quint/sandbox-lifecycle.qnt

# Dafny (4.11)
dafny verify config/verification/dafny/*.dfy

# Alloy (6.x) — jar from setup script
java -jar "$TOOLS_DIR/alloy/alloy.jar" exec -f config/verification/alloy/MidspiralTools.als
```

`$TOOLS_DIR` defaults to `partners/experiments/tools` (created by setup).

## CI

`.github/workflows/formal-verification.yml` runs Quint, Dafny, and Alloy (when jars download) on push/PR.

## Batch / ValidationEngine integration

Pybatch jobs can:

1. Set `validation.validation_cmd` to call verify scripts (source of truth), e.g.:
   ```bash
   npx --yes @informalsystems/quint@0.32.0 typecheck config/verification/quint/sandbox-lifecycle.qnt
   ```
2. Or set `validation.formal_suite` / `validation.formal_paths` — the worker expands these into a `validation_cmd` when `validation_cmd` is unset (see `pybatch/README.md`).

Example job field:

```json
"validation": {
  "formal_suite": "quint",
  "formal_paths": ["config/verification/quint/sandbox-lifecycle.qnt"],
  "max_validation_iterations": 4
}
```

## Tool versions

| Tool   | Version | Notes                          |
|--------|---------|--------------------------------|
| Quint  | ~0.32   | npm / npx                      |
| Dafny  | 4.11    | Homebrew or CI zip             |
| Alloy  | 6.2.0   | org.alloytools.alloy.dist.jar  |
| TLC    | 1.7.4   | tla2tools.jar (optional)       |
| Java   | 21      | for Alloy / TLC                |

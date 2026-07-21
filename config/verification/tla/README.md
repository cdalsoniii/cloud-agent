# TLA+ (optional)

Stub directory for temporal-logic models of cloud-agent sandbox orchestration.

Prefer Quint (`../quint/sandbox-lifecycle.qnt`) for the executable lifecycle FSM today.

When adding TLA+ specs:

1. Place `*.tla` (+ optional `*.cfg`) here
2. Parse with SANY via `./scripts/verify-local.sh` (uses `experiments/tools/tla/tla2tools.jar`)
3. Install jars with `./scripts/setup-verification-tools.sh`

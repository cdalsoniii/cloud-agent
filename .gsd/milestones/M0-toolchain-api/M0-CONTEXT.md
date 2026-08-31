# M0 CONTEXT — Toolchain & API baseline

## Goal

Establish reproducible Dafny/tool baseline and document dafny2js API env deps.

## Right-sized context

- cloud-agent: `config/verification/dafny/*.dfy`, `scripts/verify-local.sh`
- assistant-ui: Replay.dfy, `/api/verify/dafny2js`, `packages/verified-kernels`
- Env: `DAFNY2JS_PATH`, `dotnet`, `dafny` 4.11

## Non-goals

- Full product kernel generation rewrite in this milestone window

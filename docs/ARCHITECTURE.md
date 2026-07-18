# Cloud Agent Architecture

## Overview

The Cloud Agent is an autonomous software development system that orchestrates code changes
across multiple repositories using formal verification, Baseten LLM chains, sandbox providers
(Daytona/Northflank), and SurrealDB for recursive improvement.

```
                    ┌─────────────────────────┐
                    │     Cloud Agent Server    │
                    │   (src/server.ts :3000)   │
                    └───────────┬─────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  Repo Registry  │   │  SDLC Loop      │   │  Verification   │
│ (repos.yaml)    │   │  Orchestrator   │   │  Pipeline       │
│                 │   │                 │   │                 │
│ cloud-agent     │   │ research  ────► │   │ Dafny spec     │
│ gpu-inference   │   │ specify   ────► │   │ Property tests │
│ assistant-ui    │   │ design    ────► │   │ Fuzzing        │
│                 │   │ implement ────► │   │ TLA+ modeling  │
│                 │   │ verify    ────► │   │                 │
│                 │   │ review    ────► │   └─────────────────┘
└─────────────────┘   │ deploy    ────► │
                       │ monitor   ────► │
                       └────────┬────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  Baseten Chains │   │  Sandbox        │   │  Event Logger   │
│  (nwxlx5wy)     │   │  Providers      │   │  + SurrealDB    │
│                 │   │                 │   │                 │
│ deep-research   │   │ Northflank      │   │ sdlc_event      │
│ spec-from-res   │   │ Daytona         │   │ chain_execution │
│ impl-from-des   │   │ Cloudflare      │   │ verification_   │
│ verify-full     │   │                 │   │   artifact      │
│ feedback-trans  │   │                 │   │ feedback_loop   │
└─────────────────┘   └─────────────────┘   │ sdlc_learning   │
                                            └─────────────────┘
```

## Component Details

### 1. Repo Registry (`repos.yaml` + `repo-registry.ts`)
- Maps target names to repository URLs, auth, and verification rules
- Supports `--target <name>` CLI flag and `/targets` API endpoint
- Currently tracks: cloud-agent, gpu-inference-stack, assistant-ui

### 2. SDLC Loop Orchestrator (`sdlc-loop-orchestrator.ts`)
- 8-phase autonomous development cycle:
  1. **research** — Deep research via Baseten chain
  2. **specify** — Generate formal Midspiral specification
  3. **design** — Architecture tradeoff analysis
  4. **implement** — Code generation in sandbox
  5. **verify** — Formal verification pipeline
  6. **review** — Structured code review
  7. **deploy** — Deployment validation
  8. **monitor** — Telemetry analysis → next task
- Configurable verification mode (none/standard/full)
- Risk score threshold for escalation

### 3. Verification Pipeline (`verification-pipeline.ts`)
- **Dafny verification** — Formal specification checking
- **Property-based testing** — Invariant validation
- **Fuzzing** — Random input testing
- **TLA+ modeling** — Temporal logic verification
- Counterexample library for pattern matching

### 4. Event Logger + Recursive Improvement
- All events logged to SurrealDB (with in-memory fallback)
- SDLCEvent: chain inputs/outputs, verification results, sandbox execution
- LearningPattern: code patterns, counterexamples, successful strategies
- Recursive improvement: analyzes logs to improve future runs

### 5. Feedback Translation (`feedback-translator.ts`)
- Converts error messages to human-readable feedback
- Pattern matching for TypeScript, ESLint, and test failures
- LLM-powered fallback for unknown error patterns
- Self-healing specification generation

### 6. Baseten Chain Portfolio
- 11 chain specialties mapped in `repos.yaml`
- Model ID: `qelg6953`
- Chain specialties: deep-research-brief, roadmap, spec-from-research,
  design-tradeoff, impl-from-design, verify-full, feedback-translate,
  review-summarize, deploy-validate, monitor-analyze, loop-orchestrator

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Provider health status |
| GET | `/targets` | List registered repo targets |
| POST | `/verify` | Run verification pipeline |
| POST | `/sdlc` | Execute full SDLC loop |
| GET | `/learn` | Improvement metrics per repo |
| GET | `/events` | Query event logs |
| POST | `/maintenance` | Prune old events |

## Mastra Integration

Mastra is integrated into both repos:

### cloud-agent (`src/mastra/`)
- **Agent**: `daytonaOrchestrator` — orchestrates Daytona sandboxes
- **Workflow**: `daytonaOrchestrationWorkflow` — multi-step sandbox pipeline
- **Tools**: `verify-rules.ts` — formal verification tooling
- **Entry**: `src/mastra/index.ts` → `npx tsx src/mastra/index.ts --task "..."`

### assistant-ui (`packages/web/src/mastra/`)
- **Agent**: `assistant` — general-purpose conversational agent
- **API Route**: `POST /api/mastra` — SSE streaming endpoint
- **Entry**: `src/mastra/index.ts` → `getMastra()` lazy-loads agents

## Data Flow

```
User Request → /sdlc → resolveRepo() → runSDLCLoop()
                                        │
  ┌─────────────────────────────────────┘
  │  For each phase:
  │  1. logSDLCEvent(phase_start)
  │  2. Baseten chain call (smartCallChain/specialty)
  │  3. Sandbox execution (if implement phase)
  │  4. Verification (if verify phase)
  │  5. logChainExecution/cost
  │  6. translateError() if failed
  │  7. updateLearning()
  │
  ▼
  SDLCLoopResult → { success, events, phases_completed, learnings }
```

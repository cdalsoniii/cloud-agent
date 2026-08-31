# `.px/` — Ontology home (cloud-agent)

Agents **load this directory first** when reasoning about formal/ontology concepts for cloud-agent.

This is a **pointer + index** layer — not a second copy of the px-validate ontology or assistant-ui formal tree.

## Load order

1. Read `.px/config.json` (paths + product scope).
2. Read `.px/pointers.yaml` (canonical external homes).
3. Read `.px/classes/INDEX.md` (grounded class refs only).
4. If evolving schema: use **px-validate** MCP (`get_approved_classes`, `ontology_trace`, `propose_new_class`) — never invent classes here.
5. Cross-check formal specs under `config/verification/` (local) and assistant-ui paths in `pointers.yaml`.

## Layout

```
.px/
├── README.md                 # this file
├── config.json               # agent load config
├── pointers.yaml             # grounded external paths
├── classes/
│   └── INDEX.md              # approved / local / product class index
├── schema/
│   └── README.md             # LinkML / schema stubs policy
└── formal-events/
    └── README.md             # formal event / verification event pointers
```

## Grounding sources (do not fabricate)

| Source | Role |
|--------|------|
| `px-validate` `formal/` | Canonical formal stack + ontology-classes (see pointers) |
| `config/verification/` | cloud-agent Quint / Alloy / Dafny specs |
| `../../02-products/assistant-ui` | Product formal APIs, Replay.dfy, verified-kernels |
| `artifacts/prd/smoke-formal-happy-path/` | PRD issues / milestones (planning pack) |
| `.gsd/` | Durable GSD loop state for M0–M3 |

## Related

- GSD loop state: [`.gsd/README.md`](../.gsd/README.md)
- Local verify: `npm run verify:all` / `npm run smoke:formal`
- Formal PRD skill: `.agents/skills/formal-system-prd/SKILL.md`

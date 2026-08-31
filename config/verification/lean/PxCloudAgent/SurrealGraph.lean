/-
GENERATED FILE — do not edit by hand.
Produced by scripts/lean-surreal-export.ts from SurrealDB data exported over
GraphQL (ns=test, db=test) at 2026-08-02T03:46:31.944Z.

Encodes the exported ontology graph and states the invariants that a real
SurrealQL consistency check also enforces (see temporal/ontology-workflows.ts):
  - no_self_loops      source /= target on every edge
  - no_dangling_edges  every endpoint is a defined node index

These theorems are proven by `decide` over the concrete exported data, so the
Lean build fails (machine-checked) whenever the live data violates them.
-/
import PxCloudAgent.Basic

namespace PxCloudAgent

/-- A node in the exported ontology graph: index plus its natural-key id. -/
structure SurrealNode where
  index : Nat
  id : String
  deriving Repr

/-- A directed edge in the exported ontology graph (node indices). -/
structure SurrealEdge where
  source : Nat
  target : Nat
  deriving Repr

/-- Nodes exported from SurrealDB (natural-key ids). -/
def ontologyNodes : List SurrealNode :=
  [
    { index := 0, id := "sdlc_phase_research" },
    { index := 1, id := "sdlc_phase_implement" },
    { index := 2, id := "report_type_technical" },
    { index := 3, id := "report_type_finding" },
    { index := 4, id := "sdlc_phase_verify" },
    { index := 5, id := "0qyly7x5hvrlzxxkgvys" },
    { index := 6, id := "50mpe6sz9y4u9vlx4jtr" },
    { index := 7, id := "b5zc0zy7a66grtzw06gj" },
    { index := 8, id := "bms11fivolj3m2js4tyq" },
    { index := 9, id := "c2a76kcbwum6nbq2qsrs" },
    { index := 10, id := "c3d9ys7f8t9mbrsnnan7" },
    { index := 11, id := "fbvkirxqjx640rc95gcx" },
    { index := 12, id := "lmxmju2mv05i2s7wowph" },
    { index := 13, id := "r75in84fx32xx78onphl" },
    { index := 14, id := "uow6lxe7mpvbzxhx0enn" },
    { index := 15, id := "uxaxyiad0xg77dkrwsgh" },
    { index := 16, id := "x1cmlvbndihaxghaj60h" },
    { index := 17, id := "c1t6eeu6drkiyi6bp1c7" },
    { index := 18, id := "x8ijjcsobcg0loqy0aoz" },
    { index := 19, id := "alice" },
    { index := 20, id := "bob" },
    { index := 21, id := "demo" }
  ]

/-- Directed edges exported from SurrealDB (source/target node indices). -/
def ontologyEdges : List SurrealEdge :=
  [
    { source := 0, target := 1 },
    { source := 2, target := 3 },
    { source := 0, target := 1 },
    { source := 1, target := 4 },
    { source := 2, target := 3 },
    { source := 1, target := 4 }
  ]

/-- A node index is "defined" iff it appears in the exported node table. -/
def EndpointDefined (nodes : List SurrealNode) (k : Nat) : Prop :=
  nodes.exists fun n => n.index = k

/-- No exported edge is a self-loop (source = target). -/
theorem no_self_loops :
    ∀ e, e ∈ ontologyEdges → e.source ≠ e.target := by
  decide

/-- No exported edge points at an undefined (dangling) node. -/
theorem no_dangling_edges :
    ∀ e, e ∈ ontologyEdges →
      EndpointDefined ontologyNodes e.source ∧ EndpointDefined ontologyNodes e.target := by
  decide

end PxCloudAgent

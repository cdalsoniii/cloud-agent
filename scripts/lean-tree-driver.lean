import Lean
import Lean.Language.Lean
import Lean.Elab.Frontend
import Lean.Data.Json
import Lean.Elab.InfoTree

/-!
lean-tree-driver.lean — Extract a per-tactic goal tree from Lean 4 elaboration.

This driver elaborates a `.lean` module through the same incremental frontend
pipeline the `lean` binary uses (`Lean.Language.Lean.process`), collecting the
`InfoTree`s that the frontend records, and then walks each tree to pull out every
`TacticInfo` node.  Each tactic node records the *metavariable context* (goals and
hypotheses) before and after applying a tactic, which is exactly the raw material
for a proof DAG like lean-tui's `CompleteProofDag`.

For every tactic node we emit a structured JSON node (mirroring the lean-tui /
LeanPrism `ProofDagTacticNode` shape, simplified):

    {
      "id":        "<globally-unique id>",
      "tactic":    "<tactic source text>",
      "position":  {"line":.., "column":.., "endLine":.., "endColumn":..},
      "proofState": { "before": [...goals...], "after": [...goals...] },
      "depth":     <nat>,
      "mvarBefore": [...ids...],
      "mvarAfter":  [...ids...]
    }

Each goal object is:
    { "type": "<pretty-printed goal type>",
      "userName": <case/user name or null>,
      "hypotheses": [ {"name":..., "type":..., "value":?} ... ] }

Usage:
    lean -DautoImplicit=false --run lean-tree-driver.lean <module-path> <module-name>
    e.g.
    LEAN_PATH="$PWD/.lake/build/lib" lean --run scripts/lean-tree-driver.lean \
        config/verification/lean/PxCloudAgent/Trace.lean PxCloudAgent.Trace

The driver prints one JSON object to stdout: { "ok":bool, "exitCode":nat,
"error":?, "nodes":[...], "messages":[{"severity","message"}] }.
-/

open Lean Elab Elab.InfoTree

namespace PxTreeDriver

/-! ## Structured emission helpers ---/

structure Pos where
  line : Nat
  column : Nat
  deriving Repr

def mkPos (ctx : ContextInfo) (bytePos : String.Pos) : Pos :=
  let p := ctx.fileMap.toPosition bytePos
  ⟨p.line, p.column⟩

/--
Pretty-print an expression inside the given context + local context, returning the
rendered string.  `ctx.runMetaM lctx ...` executes a `MetaM` action using the
context's env, mctx and options, with the given local context installed.
-/
def ppExprStr (ctx : ContextInfo) (lctx : LocalContext) (e : Expr) : IO String := do
  let fmt ← ctx.runMetaM lctx (Lean.Meta.ppExpr e)
  pure (Format.pretty fmt).trim

/--
Render a goal (metavariable) as a structured JSON object: the pretty-printed type
plus the local-context hypotheses.  The metavariable declaration is looked up in the
given context's metavariable context (which is what `runMetaM` installs).
-/
def ppGoalStructured (ctx : ContextInfo) (goal : MVarId) : IO Json := do
  match ctx.mctx.findDecl? goal with
  | none =>
      return Json.mkObj
        [ ("type", Json.str "<unknown goal>"), ("userName", Json.null), ("hypotheses", Json.arr #[]) ]
  | some decl =>
      let lctx := decl.lctx
      let typeStr ← ppExprStr ctx lctx decl.type
      let user := match decl.userName.simpMacroScopes with
        | Name.anonymous => Json.null
        | n => Json.str n.toString
      let decls := decl.lctx.decls.toList.filterMap (fun d? => d?)
      let mut hyps : Array Json := #[]
      for ldecl in decls do
        let nameStrs := ldecl.userName.simpMacroScopes.toString
        let typeStr ← ppExprStr ctx lctx ldecl.type
        let valJson ← if ldecl.isLet then
          let v := ldecl.value
          let vs ← ppExprStr ctx lctx v
          pure (Json.str vs)
        else
          pure Json.null
        hyps := hyps.push (Json.mkObj [("name", Json.str nameStrs), ("type", Json.str typeStr), ("value", valJson)])
      return Json.mkObj
        [ ("type", Json.str typeStr), ("userName", user), ("hypotheses", Json.arr hyps) ]

/-- Pretty-print all goals in a list, returning a JSON array of goal objects. -/
def ppGoalsStructured (ctx : ContextInfo) (goals : List MVarId) : IO Json := do
  let arr ← goals.mapM (ppGoalStructured ctx)
  return Json.arr arr.toArray

/-! ## InfoTree traversal -/

/--
Extract the raw source text of a tactic's syntax node using the source `fileMap`.
This is more faithful than pretty-printing the parsed term (no re-parenthesization,
no synthesised-only info), and it runs purely in `IO`.
-/
def tacticSource (ctx : ContextInfo) (stx : Syntax) : String :=
  let start := stx.getPos?.getD 0
  let endPos := stx.getTailPos?.getD start
  ctx.fileMap.source.extract start endPos

/--
Collect a single `TacticInfo` node into a JSON object, rendering the goal states
before and after the tactic using the recorded metavariable contexts.
-/
private def collectTactic (ctx : ContextInfo) (info : TacticInfo) (depth : Nat) (id : String) : IO Json := do
  let before ← ppGoalsStructured { ctx with mctx := info.mctxBefore } info.goalsBefore
  let after  ← ppGoalsStructured { ctx with mctx := info.mctxAfter } info.goalsAfter
  let startP := mkPos ctx (info.stx.getPos?.getD 0)
  let endP   := mkPos ctx (info.stx.getTailPos?.getD (info.stx.getPos?.getD 0))
  let tacticStr := tacticSource ctx info.stx
  pure <| Json.mkObj
    [ ("id", Json.str id),
      ("tactic", Json.str tacticStr),
      ("position", Json.mkObj
          [ ("line", Json.num startP.line), ("column", Json.num startP.column),
            ("endLine", Json.num endP.line), ("endColumn", Json.num endP.column) ]),
      ("depth", Json.num depth),
      ("before", before),
      ("after", after),
      ("mvarBefore", Json.arr (info.goalsBefore.map fun g => Json.str g.name.toString).toArray),
      ("mvarAfter",  Json.arr (info.goalsAfter.map  fun g => Json.str g.name.toString).toArray) ]

/--
Walk an `InfoTree`, collecting the tactic nodes.  A single source file's elaboration
produces a *forest* of `InfoTree`s (one per top-level command), which `main` iterates.
`Info.updateContext?` is used to thread the metavariable context so nested `TacticInfo`
nodes (e.g. from `simp`-expanded sub-proofs or `calc` steps) format correctly.
-/
partial def walk (ctx? : Option ContextInfo) (tree : InfoTree) (depth : Nat) (nextId : Nat) (acc : Array Json) : IO (Array Json × Nat) := do
  match tree with
  | InfoTree.hole _ => pure (acc, nextId)
  | InfoTree.context i t =>
      let ctx := i.mergeIntoOuter? ctx?
      walk ctx t (depth + 1) nextId acc
  | InfoTree.node i cs =>
      match ctx? with
      | none =>
          let rec loop (cs : List InfoTree) (n : Nat) (a : Array Json) : IO (Array Json × Nat) :=
            match cs with
            | [] => pure (a, n)
            | c :: rest => do
                let (a', n') ← walk none c (depth + 1) n a
                loop rest n' a'
          loop cs.toList nextId acc
      | some ctx =>
          let ctx' := i.updateContext? ctx?
          let rec loopCtx (cs : List InfoTree) (n : Nat) (a : Array Json) : IO (Array Json × Nat) :=
            match cs with
            | [] => pure (a, n)
            | c :: rest => do
                let (a', n') ← walk ctx' c (depth + 1) n a
                loopCtx rest n' a'
          match i with
          | Info.ofTacticInfo tinfo =>
              -- gather this tactic node (best-effort; on error record it as such)
              let newNode : IO (Array Json) := do
                let id := "t" ++ toString nextId
                let node ← try collectTactic ctx tinfo depth id
                  catch _ => pure (Json.mkObj [("id", Json.str id), ("error", Json.str "collectTactic failed")])
                pure (acc.push node)
              let acc ← newNode
              loopCtx cs.toList (nextId + 1) acc
          | _ =>
              loopCtx cs.toList nextId acc

/-! ## Frontend driver — elaborate a file capturing InfoTrees -/

/--
Run the Lean language frontend on `input` (the module source) and return the array
of InfoTrees produced for every top-level command, by mirroring `runFrontend`.
-/
def elaborateCollect (input : String) (opts : Options) (fileName : String) (mainModuleName : Name) : IO (Array InfoTree × Bool) := do
  let inputCtx := Parser.mkInputContext input fileName
  let opts := Lean.Language.Lean.internal.cmdlineSnapshots.setIfNotSet opts true
  let ctx := { inputCtx with }
  let processor := Lean.Language.Lean.process
  let snap ← processor (fun _ => pure <| .ok { mainModuleName, opts, trustLevel := 0 }) none ctx
  let snaps := Lean.Language.toSnapshotTree snap
  -- Force the whole snapshot tree to run to conclusion.  Unlike `runAndReport` we do
  -- NOT print every message here: the module's own `set_option trace.*` directives
  -- would otherwise pollute stdout with the reasoning trail, which is not what this
  -- driver emits.  The per-tactic goal tree comes from the InfoTrees below.
  snaps.forM (fun _ => pure ())
  -- Every finished command snapshot carries its InfoTree.
  let trees := snaps.getAll.filterMap (·.infoTree?)
  let hasErrors := snaps.getAll.any (·.diagnostics.msgLog.hasErrors)
  pure (trees, !hasErrors)

/-! ## top-level main: read file, elaborate, walk, emit JSON -/

end PxTreeDriver

open Lean Json
open PxTreeDriver

def main (args : List String) : IO UInt32 := do
  let mut ok := true
  let mut exitCode := 0
  let mut errMsg : Option String := none
  let mut nodes : Array Json := #[]
  if args.length < 2 then
    IO.println <| Json.compress <| Json.mkObj
      [ ("ok", Json.bool false), ("exitCode", Json.num 1),
        ("error", Json.str "usage: lean-tree-driver.lean <module-path> <module-name>"),
        ("nodes", Json.arr #[]), ("messages", Json.arr #[]) ]
    return 1
  let filePath := args.get! 0
  let modArg := args.get! 1
  -- Parse a dotted module name like "PxCloudAgent.Trace" into a `Name`.
  let modName : Name :=
    (modArg.splitOn ".").foldl (fun acc s => Name.str acc s) Name.anonymous
  try
    let src ← IO.FS.readFile filePath
    -- `autoImplicit` is a registered builtin option; we must disable it to match the
    -- PxCloudAgent module (which does `set_option autoImplicit false`).
    let opts : Options := Lean.Options.empty.setBool `autoImplicit false
    let (trees, okElab) ← elaborateCollect src opts filePath modName
    if !okElab then
      errMsg := some "module failed to elaborate (see messages)"
      ok := false
    let init : Array Json × Nat := (#[], 0)
    let (nodes', _) ← trees.toList.foldlM (fun st t => walk none t 0 st.2 st.1) init
    nodes := nodes'
    if trees.isEmpty then
      errMsg := some "no InfoTrees captured (module likely failed to elaborate)"
      ok := false
  catch e =>
    ok := false
    exitCode := 1
    errMsg := some (toString e)
  let messages : Array Json := if errMsg.isSome then
    #[Json.mkObj [("severity", Json.str "error"), ("message", Json.str errMsg.get!)]]
    else #[]
  let out := Json.mkObj
    [ ("ok", Json.bool ok), ("exitCode", Json.num exitCode),
      ("error", match errMsg with | some e => Json.str e | none => Json.null),
      ("nodes", Json.arr nodes), ("messages", Json.arr messages) ]
  IO.println <| Json.pretty out
  return if ok then 0 else 1

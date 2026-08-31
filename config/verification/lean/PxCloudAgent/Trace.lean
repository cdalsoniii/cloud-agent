/-
Trace-enabled variant of PxCloudAgent.Basic used to capture the Lean 4
reasoning trail (per-step simp rewriting / goal states) for the lean-live pane.

The `set_option trace.*` directives are what make `lean` emit the actual
per-step reasoning to stdout during elaboration.  Kept alive as a deliberately
traced proof so the lean-live bridge can replay a genuine trail.
-/
import PxCloudAgent.Basic

set_option trace.Meta.Tactic.simp true
set_option trace.Meta.Tactic.simp.rewrite true
set_option trace.Meta.Tactic.induction true

namespace PxCloudAgent

theorem add_comm_traced : ∀ a b : Nat, a + b = b + a := by
  intro a
  induction a with
  | zero =>
      intro b
      simp
  | succ a ih =>
      intro b
      calc
        Nat.succ a + b = Nat.succ (a + b) := by rw [Nat.succ_add]
        _ = Nat.succ (b + a)     := by rw [ih]
        _ = b + Nat.succ a       := by rw [Nat.add_succ]

end PxCloudAgent

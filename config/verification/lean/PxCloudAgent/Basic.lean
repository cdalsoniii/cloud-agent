/-!
PX Grok lean-live bridge theorems.

Each theorem requires the Lean 4 prover to do real work -- induction on the
natural numbers, rewriting with the recursive definition of addition, and a
congruence argument -- rather than closing with `trivial`.

Notes on this workspace:
- Built with `autoImplicit=false`, so `Nat.succ` is written explicitly.
- Lean's `Nat.add` recurses on the SECOND argument, so `Nat.succ a + b` is
  *not* definitionally `Nat.succ (a + b)`; we must use `Nat.succ_add`.
- `Nat.add_succ : b + Nat.succ a = Nat.succ (b + a)` handles the right side.
-/
namespace PxCloudAgent

/-- Trivial theorem kept for the smoke-grok-lean.sh baseline. -/
theorem smoke_ok : True := trivial

/-- Commutativity of addition, by induction on the first argument.

    succ case:
      Nat.succ a + b   = Nat.succ (a + b)   -- Nat.succ_add
      Nat.succ (a+b)   = Nat.succ (b + a)   -- ih
      Nat.succ (b + a) = b + Nat.succ a     -- Nat.add_succ
-/
theorem add_comm' : ∀ a b : Nat, a + b = b + a := by
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

/-- Associativity of addition, by induction on the first argument. -/
theorem add_assoc' (a b c : Nat) : (a + b) + c = a + (b + c) := by
  induction a with
  | zero => simp
  | succ a ih =>
      calc
        (Nat.succ a + b) + c = Nat.succ ((a + b) + c) := by rw [Nat.succ_add, Nat.succ_add]
        _ = Nat.succ (a + (b + c)) := by rw [ih]
        _ = Nat.succ a + (b + c)   := by rw [Nat.succ_add]

/-- `Nat.succ` is injective -- a congruence argument on equal successors. -/
theorem succ_inj (a b : Nat) : Nat.succ a = Nat.succ b → a = b := by
  intro h
  injection h

/-- Natural numbers are not less than themselves. -/
theorem lt_irrefl' (n : Nat) : ¬ n < n := by
  exact Nat.lt_irrefl n

/-- A small arithmetic identity: (a + b) - a = b. -/
theorem add_sub_cancel (a b : Nat) : (a + b) - a = b := by
  induction a with
  | zero => simp
  | succ a ih =>
      calc
        (Nat.succ a + b) - Nat.succ a = Nat.succ ((a + b)) - Nat.succ a := by rw [Nat.succ_add]
        _ = (a + b) - a := by rw [Nat.succ_sub_succ]
        _ = b := ih

end PxCloudAgent

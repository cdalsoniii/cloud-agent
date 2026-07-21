// Business-rule consistency for cloud-agent Midspiral rules.
// Rules must have conditions+actions; no contradictory conditions on same field.

module BusinessRules

sig Rule {
  conditions: set Condition,
  actions: set Action
}

sig Condition {
  field: one Field,
  value: one Value
}

sig Action {
  target: one Target,
  op: one Op
}

sig Field {}
sig Value {}
sig Target {}
sig Op {}

fact RuleStructure {
  all r: Rule | some r.conditions && some r.actions
}

fact NoContradictoryConditions {
  all r: Rule |
    no disj c1, c2: r.conditions |
      c1.field = c2.field && c1.value != c2.value
}

assert ConsistentConditions {
  all r: Rule |
    no disj c1, c2: r.conditions |
      c1.field = c2.field && c1.value != c2.value
}

check ConsistentConditions for 10

run { some Rule } for 10

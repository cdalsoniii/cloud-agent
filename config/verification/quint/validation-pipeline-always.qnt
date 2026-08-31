// Always-on validation pipeline FSM (MCP + tool_io_guard).
// Models: enforcement flag, gated tools, pre refuse, post block, cascade outcome.
// Offline-checkable safety properties — prove before relying on live Daytona.
//
// Maps to:
//   handleToolIoGuard (enforceSchema default true)
//   MCP CallTool middleware (isGatedMcpTool + pre/post)
//   ontologyEnforcement / PX_VALIDATION_PROFILE=strict
//
// Does NOT claim free-form chat is gated without a host plugin (see ChatUngated).

module validation_pipeline_always {
  // --- State ---
  var enforcement: bool
  var tool_gated: bool
  var phase: str
  // phases: idle | pre | executing | post | refused | done | blocked_post
  var pre_ok: bool
  var post_ok: bool
  var cascade_ran: bool
  var tool_executed: bool
  var scope_tag_set: bool
  var pack_known: bool

  action init = all {
    enforcement' = true,
    tool_gated' = true,
    phase' = "idle",
    pre_ok' = false,
    post_ok' = false,
    cascade_ran' = false,
    tool_executed' = false,
    scope_tag_set' = false,
    pack_known' = false,
  }

  // Operator / config: turn enforcement on (always allowed)
  action enforce_on = all {
    phase == "idle" or phase == "done" or phase == "refused" or phase == "blocked_post",
    enforcement' = true,
    tool_gated' = tool_gated,
    phase' = "idle",
    pre_ok' = false,
    post_ok' = false,
    cascade_ran' = false,
    tool_executed' = false,
    scope_tag_set' = scope_tag_set,
    pack_known' = pack_known,
  }

  // Strict profile forbids enforce_off without allow flag — model as absent action
  // (no enforce_off action = enforcement cannot be disabled in this model)

  action set_pack = all {
    phase == "idle",
    pack_known' = true,
    scope_tag_set' = true,
    enforcement' = enforcement,
    tool_gated' = tool_gated,
    phase' = phase,
    pre_ok' = pre_ok,
    post_ok' = post_ok,
    cascade_ran' = cascade_ran,
    tool_executed' = tool_executed,
  }

  // Cheap scope without full cascade (px_ontology_scope)
  action scope_only = all {
    phase == "idle",
    pack_known' = true,
    scope_tag_set' = true,
    cascade_ran' = false,
    enforcement' = enforcement,
    tool_gated' = tool_gated,
    phase' = "idle",
    pre_ok' = pre_ok,
    post_ok' = post_ok,
    tool_executed' = false,
  }

  // PRE tool_io_guard for gated tool with enforcement on
  action pre_pass = all {
    phase == "idle",
    enforcement == true,
    tool_gated == true,
    phase' = "pre",
    pre_ok' = true,
    cascade_ran' = true,
    post_ok' = false,
    tool_executed' = false,
    enforcement' = true,
    tool_gated' = true,
    scope_tag_set' = true,
    pack_known' = true,
  }

  action pre_fail = all {
    phase == "idle",
    enforcement == true,
    tool_gated == true,
    phase' = "refused",
    pre_ok' = false,
    cascade_ran' = true,
    post_ok' = false,
    tool_executed' = false,
    enforcement' = true,
    tool_gated' = true,
    scope_tag_set' = true,
    pack_known' = true,
  }

  // Execute only after pre pass
  action execute = all {
    phase == "pre",
    pre_ok == true,
    phase' = "executing",
    tool_executed' = true,
    pre_ok' = true,
    post_ok' = false,
    cascade_ran' = cascade_ran,
    enforcement' = enforcement,
    tool_gated' = tool_gated,
    scope_tag_set' = scope_tag_set,
    pack_known' = pack_known,
  }

  action post_pass = all {
    phase == "executing",
    tool_executed == true,
    phase' = "done",
    post_ok' = true,
    pre_ok' = pre_ok,
    cascade_ran' = true,
    tool_executed' = true,
    enforcement' = enforcement,
    tool_gated' = tool_gated,
    scope_tag_set' = scope_tag_set,
    pack_known' = pack_known,
  }

  action post_fail = all {
    phase == "executing",
    tool_executed == true,
    phase' = "blocked_post",
    post_ok' = false,
    pre_ok' = pre_ok,
    cascade_ran' = true,
    tool_executed' = true,
    enforcement' = enforcement,
    tool_gated' = tool_gated,
    scope_tag_set' = scope_tag_set,
    pack_known' = pack_known,
  }

  // Ungated tools may execute without cascade when enforcement on
  action ungated_execute = all {
    phase == "idle",
    tool_gated == false,
    phase' = "done",
    tool_executed' = true,
    cascade_ran' = false,
    pre_ok' = true,
    post_ok' = true,
    enforcement' = enforcement,
    tool_gated' = false,
    scope_tag_set' = scope_tag_set,
    pack_known' = pack_known,
  }

  action mark_ungated = all {
    phase == "idle",
    tool_gated' = false,
    enforcement' = enforcement,
    phase' = "idle",
    pre_ok' = false,
    post_ok' = false,
    cascade_ran' = false,
    tool_executed' = false,
    scope_tag_set' = scope_tag_set,
    pack_known' = pack_known,
  }

  action mark_gated = all {
    phase == "idle",
    tool_gated' = true,
    enforcement' = enforcement,
    phase' = "idle",
    pre_ok' = false,
    post_ok' = false,
    cascade_ran' = false,
    tool_executed' = false,
    scope_tag_set' = scope_tag_set,
    pack_known' = pack_known,
  }

  action step = any {
    enforce_on,
    set_pack,
    scope_only,
    mark_ungated,
    mark_gated,
    pre_pass,
    pre_fail,
    execute,
    post_pass,
    post_fail,
    ungated_execute,
  }

  // -------- Safety properties (must hold in all reachable states of runs) --------

  // S1: If pre failed, tool never executed
  val PreFailImpliesNoExecute =
    (phase == "refused") implies (tool_executed == false)

  // S2: Tool execution implies pre succeeded (for gated+enforced path that reached executing/done/blocked_post with cascade)
  val ExecuteImpliesPreOk =
    (tool_executed and cascade_ran and tool_gated and enforcement)
      implies (pre_ok == true)

  // S3: Refused state never has executed tool
  val RefusedNoExec = (phase == "refused") implies (tool_executed == false)

  // S4: Done after gated path means cascade ran
  val GatedDoneRanCascade =
    (phase == "done" and tool_gated and enforcement and tool_executed and pre_ok)
      implies cascade_ran

  // S5: blocked_post means execute happened (post can only fail after exec)
  val BlockedPostAfterExec =
    (phase == "blocked_post") implies (tool_executed == true)

  // S6: Chat limitation documented — scope can be set without cascade
  // (not a bug; property that scope_only leaves cascade_ran false is allowed)
  val ScopeWithoutCascadeOk =
    true

  // Combined invariant for simulation checks
  val PipelineSafety =
    PreFailImpliesNoExecute
      and ExecuteImpliesPreOk
      and RefusedNoExec
      and BlockedPostAfterExec

  // Happy path: pack → pre pass → execute → post pass
  run happy_gated =
    init
      .then(set_pack)
      .then(pre_pass)
      .then(execute)
      .then(post_pass)

  // Fail-closed pre
  run pre_refuses =
    init
      .then(set_pack)
      .then(pre_fail)

  // Post blocks after execute
  run post_blocks =
    init
      .then(pre_pass)
      .then(execute)
      .then(post_fail)

  // Scope without full cascade (chat metadata path)
  run scope_chat =
    init
      .then(scope_only)

  // Ungated path (no cascade required)
  run ungated =
    init
      .then(mark_ungated)
      .then(ungated_execute)

  // Multi-step nondeterministic exploration
  run explore = init.then(step).then(step).then(step).then(step)
}

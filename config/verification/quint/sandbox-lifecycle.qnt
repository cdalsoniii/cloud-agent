// Sandbox lifecycle FSM for cloud-agent / Daytona SDK path.
// Phases: none → created → bootstrapped → executing → destroyed
// Safety: no use-after-destroy; destroy only from a live phase.

module sandbox_lifecycle {
  var phase: str
  var sandbox_id: str
  var destroyed: bool

  action init = all {
    phase' = "none",
    sandbox_id' = "",
    destroyed' = false,
  }

  action create(id) = all {
    phase == "none",
    destroyed == false,
    phase' = "created",
    sandbox_id' = id,
    destroyed' = false,
  }

  action bootstrap = all {
    phase == "created",
    destroyed == false,
    sandbox_id != "",
    phase' = "bootstrapped",
    sandbox_id' = sandbox_id,
    destroyed' = false,
  }

  action exec = all {
    phase == "bootstrapped" or phase == "executing",
    destroyed == false,
    sandbox_id != "",
    phase' = "executing",
    sandbox_id' = sandbox_id,
    destroyed' = false,
  }

  action destroy = all {
    phase == "created" or phase == "bootstrapped" or phase == "executing",
    destroyed == false,
    sandbox_id != "",
    phase' = "destroyed",
    sandbox_id' = sandbox_id,
    destroyed' = true,
  }

  action step = any {
    create("sb-1"),
    bootstrap,
    exec,
    destroy,
  }

  // Safety: once destroyed, never leave destroyed phase / never clear the flag.
  val NoUseAfterDestroy = destroyed implies (phase == "destroyed")

  // Safety: live phases always carry a sandbox id.
  val LiveHasId =
    (phase == "created" or phase == "bootstrapped" or phase == "executing")
      implies (sandbox_id != "")

  run simulation = init.then(step).then(step).then(step)
}

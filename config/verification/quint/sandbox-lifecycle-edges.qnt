// Edge cases for sandbox lifecycle: destroy-from-created, no recreate after destroy.
module sandbox_lifecycle_edges {
  var phase: str
  var destroyed: bool

  action init = all {
    phase' = "none",
    destroyed' = false,
  }

  action create = all {
    phase == "none",
    destroyed == false,
    phase' = "created",
    destroyed' = false,
  }

  action destroyFromCreated = all {
    phase == "created",
    destroyed == false,
    phase' = "destroyed",
    destroyed' = true,
  }

  action step = any { create, destroyFromCreated }

  val NoResurrect = destroyed implies (phase == "destroyed")

  run simulation = init.then(step).then(step)
}
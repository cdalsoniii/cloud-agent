// sandbox-roles.qnt — role + public surface model (sync with SandboxTypeRegistry)
// Illegal: editor with publicSurface != none; agent using compiler; editor → MCP without formal.

module sandbox_roles {
  type Role = | Editor | Formal | Agent | LegacyPacked
  type PublicSurface = | None | OntologyUi | ValidateApi | AgentApp
  type OntologyStage = | Edit | Stabilize | Consume | Demo

  pure def stageOf(r: Role): OntologyStage = match r {
    | Editor => Edit
    | Formal => Stabilize
    | Agent => Consume
    | LegacyPacked => Demo
  }

  pure def allowedSurface(r: Role, s: PublicSurface): bool = match r {
    | Editor => s == None
    | Formal => s == None or s == OntologyUi or s == ValidateApi
    | Agent => s == None or s == AgentApp
    | LegacyPacked => true
  }

  // Transition: Edit -> Stabilize -> Consume
  pure def canTransition(from: OntologyStage, to: OntologyStage): bool =
    (from == Edit and to == Stabilize) or
    (from == Stabilize and to == Consume) or
    (from == to)

  pure def mcpAllowed(r: Role, hasValidationToken: bool): bool = match r {
    | Editor => false
    | Formal => false  // formal serves validation, is not egress MCP client
    | Agent => hasValidationToken
    | LegacyPacked => true
  }
}

/-!
AUTO-GENERATED from LinkML pack `oteemo` — do not edit by hand.
Root class: Engagement
Regenerate: scripts/linkml-to-lean.py / generate-linkml-artifacts.sh
-/
namespace PxCloudAgent.Generated.Oteemo

inductive EngagementTierEnum where
  | assess
  | transform
  | managed
  | advisory
  deriving Repr, DecidableEq

inductive EnvironmentEnum where
  | sandbox
  | dev
  | stage
  | prod
  deriving Repr, DecidableEq

inductive PipelineStageEnum where
  | plan
  | build
  | test
  | secure
  | deploy
  | operate
  deriving Repr, DecidableEq

inductive ControlDomainEnum where
  | sast
  | sca
  | secrets
  | container
  | iac
  | runtime
  | identity
  | compliance
  deriving Repr, DecidableEq

inductive FindingSeverityEnum where
  | info
  | low
  | medium
  | high
  | critical
  deriving Repr, DecidableEq

inductive ControlStatusEnum where
  | planned
  | enabled
  | failing
  | waived
  | blocked
  deriving Repr, DecidableEq

inductive AssumptionPhaseEnum where
  | pre
  | post
  | both
  deriving Repr, DecidableEq

inductive AxiomAcceleratorEnum where
  | forge
  | flow
  | shield
  | clarity
  deriving Repr, DecidableEq

inductive GovernanceSurfaceEnum where
  | workforce
  | control_plane
  deriving Repr, DecidableEq

inductive TrustPostureEnum where
  | trust_to_deploy
  | speed_to_deploy
  deriving Repr, DecidableEq

inductive CriticalPathStageEnum where
  | schema_sot
  | regenerate_artifacts
  | cascade_validate
  | pre_hook
  | post_hook
  | governed_runtime
  deriving Repr, DecidableEq

inductive RecoveryPathEnum where
  | reassess
  | realign
  | remap
  | retrain
  | relaunch
  deriving Repr, DecidableEq

inductive MeetingKindEnum where
  | oteemo_side_client_state
  | weekly_operating_review
  | sponsor_realign
  | recovery_exit_review
  deriving Repr, DecidableEq

inductive DaciRoleEnum where
  | driver
  | approver
  | contributor
  | informed
  deriving Repr, DecidableEq

structure Customer where
  customer_id : String
  name : String
  industry : String
  clearance_required : Bool
  deriving Repr

structure PlatformProfile where
  platform_id : String
  customer_id : String
  cloud : String
  kubernetes_distro : String
  gitops : Bool
  environment : EnvironmentEnum
  deriving Repr

structure SecurityControl where
  control_id : String
  name : String
  domain : ControlDomainEnum
  stage : PipelineStageEnum
  blocking : Bool
  status : ControlStatusEnum
  owner : String
  axiom_accelerator : AxiomAcceleratorEnum
  deriving Repr

structure PipelineGate where
  gate_id : String
  pipeline_id : String
  stage : PipelineStageEnum
  order : Nat
  control_ids : List String
  requires_all_pass : Bool
  deriving Repr

structure Finding where
  finding_id : String
  control_id : String
  severity : FindingSeverityEnum
  title : String
  waived : Bool
  cve_id : String
  blocks_deploy : Bool
  deriving Repr

structure TypedAssumptionContext where
  context_id : String
  meeting_kind : MeetingKindEnum
  recovery_step : RecoveryPathEnum
  axiom_accelerator : AxiomAcceleratorEnum
  trust_posture : TrustPostureEnum
  notes : String
  deriving Repr

structure DaciAssignment where
  assignment_id : String
  role : DaciRoleEnum
  actor : String
  deriving Repr

structure MeetingAgendaItem where
  item_id : String
  title : String
  requires_decision : Bool
  acceptance_criteria : String
  deriving Repr

structure ClientStateMeeting where
  meeting_id : String
  kind : MeetingKindEnum
  non_blame_frame : Bool
  daci : List DaciAssignment
  agenda : List MeetingAgendaItem
  recovery_path : List RecoveryPathEnum
  deriving Repr

structure CriticalPathStep where
  step_id : String
  stage : CriticalPathStageEnum
  order : Nat
  description : String
  must_pass : Bool
  deriving Repr

structure SemanticGateRule where
  rule_id : String
  name : String
  when_severity : FindingSeverityEnum
  when_unwaived : Bool
  blocks_tool : String
  rationale : String
  deriving Repr

structure AgentAssumption where
  assumption_id : String
  phase : AssumptionPhaseEnum
  tool_name : String
  claim : String
  payload : String
  structured_context : Option TypedAssumptionContext
  expected_conforms : Bool
  engagement_id : String
  deriving Repr

structure Engagement where
  engagement_id : String
  customer : Customer
  tier : EngagementTierEnum
  platform : PlatformProfile
  controls : List SecurityControl
  gates : List PipelineGate
  findings : List Finding
  assumptions : List AgentAssumption
  meetings : List ClientStateMeeting
  critical_path : List CriticalPathStep
  semantic_rules : List SemanticGateRule
  trust_posture : TrustPostureEnum
  primary_accelerator : AxiomAcceleratorEnum
  governance_surface : GovernanceSurfaceEnum
  revision : String
  environment : EnvironmentEnum
  deriving Repr

/-- Root type for pack `oteemo` is available for machine-checked consumers. -/
def rootTypeName : String := "Engagement"

/-- Smoke: root structure name is non-empty. -/
theorem root_name_nonempty : rootTypeName.length > 0 := by native_decide

end PxCloudAgent.Generated.Oteemo

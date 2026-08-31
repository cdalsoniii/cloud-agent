import Lake
open Lake DSL

package «px-cloud-agent-lean» where
  leanOptions := #[
    ⟨`autoImplicit, false⟩
  ]

lean_lib PxCloudAgent where
  roots := #[
    `PxCloudAgent.Basic,
    `PxCloudAgent.Trace,
    `PxCloudAgent.Generated.Oteemo
  ]

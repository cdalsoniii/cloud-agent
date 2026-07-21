// Midspiral / Mastra MCP tool graph for cloud-agent.
// Invariant: tool dependency graph is acyclic; Daytona ops are SDK-only.

module MidspiralTools

abstract sig Tool {
  dependencies: set Tool
}

sig EnvValidation, DaytonaCreate, DaytonaBootstrap,
    DaytonaExec, DaytonaDestroy, VerifyRules extends Tool {}

sig DaytonaSdkPath, ProviderShPath {}

sig SandboxOp {
  tool: one Tool,
  path: lone (DaytonaSdkPath + ProviderShPath)
}

fact AcyclicDependencies {
  no t: Tool | t in t.^dependencies
}

fact UniqueTools {
  all disj t1, t2: Tool | t1 != t2
}

// Daytona lifecycle tools must use SDK path, never provider.sh.
fact SdkOnlyDaytona {
  all op: SandboxOp |
    op.tool in (DaytonaCreate + DaytonaBootstrap + DaytonaExec + DaytonaDestroy)
      implies (some op.path & DaytonaSdkPath and no op.path & ProviderShPath)
}

assert NoCircularDependencies {
  all t: Tool | t not in t.^dependencies
}

assert NoProviderShForDaytona {
  no op: SandboxOp |
    op.tool in (DaytonaCreate + DaytonaBootstrap + DaytonaExec + DaytonaDestroy)
      and some op.path & ProviderShPath
}

check NoCircularDependencies for 8
check NoProviderShForDaytona for 8

run { some Tool and some SandboxOp } for 8

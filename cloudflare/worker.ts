import { Container, getContainer } from "@cloudflare/containers"

export type CloudAgentEnv = {
  CLOUD_AGENT: DurableObjectNamespace<CloudAgentContainer>
}

export class CloudAgentContainer extends Container<CloudAgentEnv> {
  defaultPort = 3000
  sleepAfter = "30m"
  enableInternet = true
  pingEndpoint = "/health"

  constructor(ctx: DurableObjectState, env: CloudAgentEnv) {
    super(ctx, env)
    this.envVars = {
      NODE_ENV: "production",
      PORT: "3000",
      HOSTNAME: "0.0.0.0",
    }
  }

  override onStart(): void {
    console.log("cloud-agent container started")
  }

  override onStop(): void {
    console.log("cloud-agent container stopped")
  }

  override onError(error: unknown): unknown {
    console.error("cloud-agent container error", error)
    throw error
  }
}

export default {
  async fetch(request: Request, env: CloudAgentEnv): Promise<Response> {
    const container = getContainer(env.CLOUD_AGENT, "develop")
    return container.fetch(request)
  },
}

# PRD: Next.js + Mastra.ai MCP Generation Tool with Formal Verification

## Document Info
| Field | Value |
|-------|-------|
| Version | 1.0.0 |
| Author | Cloud Agent Orchestrator |
| Date | 2026-07-18 |
| Status | Draft |

## 1. Executive Summary

Build a Next.js application powered by Mastra.ai that generates verified MCP (Model Context Protocol) tools in a remote sandbox environment. The system uses Dafny JavaScript/WebAssembly for formal UI state verification and Midspiral tools for runtime state verification. Diagrams (Mermaid/Flow) must be rendered correctly and verified.

## 2. Goals & Objectives

| Goal | Priority | Verification Method |
|------|----------|---------------------|
| Generate MCP tool definitions via Mastra.ai agents | P0 | Dafny JS validates generated JSON schema |
| Render state diagrams correctly | P0 | Visual diff + Midspiral state checks |
| Run end-to-end in Daytona sandbox | P0 | CI/CD pipeline passes |
| Formal UI state verification | P1 | Dafny JS invariants |
| Midspiral runtime state verification | P1 | Rule engine checks |

## 3. Architecture Overview

```
+-------------------------------------------------------------+
|                     User (Browser)                          |
+-------------------------------------------------------------+
                          |
                          v
+-------------------------------------------------------------+
|                  Next.js App (Port 3000)                    |
|  +------------------+  +------------------+  +-----------+  |
|  | MCP Generator UI |  | Diagram Renderer |  | Dafny   |  |
|  | (React Components)|  | (Mermaid/Flow)   |  | Verify  |  |
|  +------------------+  +------------------+  +-----------+  |
+-------------------------------------------------------------+
                          |
                          v
+-------------------------------------------------------------+
|                  Mastra.ai Server (Port 4111)              |
|  +------------------+  +------------------+  +-----------+  |
|  | MCP Agent        |  | Verify Agent      |  | State    |  |
|  | (Tool Generation)|  | (Dafny+Midspiral) |  | Manager  |  |
|  +------------------+  +------------------+  +-----------+  |
+-------------------------------------------------------------+
                          |
                          v
+-------------------------------------------------------------+
|                  Daytona Sandbox (Remote)                  |
|  +------------------+  +------------------+  +-----------+  |
|  | Node.js 20       |  | Dafny Runtime    |  | MCP Server|  |
|  | Next.js Dev      |  | (WASM/JS)        |  | (Test)    |  |
|  +------------------+  +------------------+  +-----------+  |
+-------------------------------------------------------------+
```

## 4. Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| Frontend | Next.js | 15.x | React framework with App Router |
| UI | Tailwind CSS + shadcn/ui | latest | Styling |
| Agent Framework | Mastra.ai | latest | AI agent orchestration |
| Diagrams | Mermaid.js + ReactFlow | latest | State diagram rendering |
| Formal Verification | Dafny JS (WebAssembly) | latest | UI state invariants |
| Runtime Verification | Midspiral | latest | State rule checking |
| MCP | @mastra/mcp | latest | MCP tool generation |
| Sandbox | Daytona | latest | Remote execution |
| Testing | Playwright + Jest | latest | E2E + unit tests |

## 5. Component Breakdown

### 5.1 Next.js Application (`apps/mcp-verifier/`)

```
apps/mcp-verifier/
├── app/
│   ├── page.tsx              # Main dashboard
│   ├── layout.tsx            # Root layout with providers
│   ├── api/
│   │   ├── mastra/
│   │   │   └── route.ts      # Mastra API route
│   │   ├── generate-mcp/
│   │   │   └── route.ts      # MCP generation endpoint
│   │   ├── verify/
│   │   │   └── route.ts      # Verification endpoint
│   │   └── diagram/
│   │       └── route.ts      # Diagram generation endpoint
│   └── components/
│       ├── McpGenerator.tsx    # MCP tool generation UI
│       ├── DiagramViewer.tsx   # Mermaid/Flow renderer
│       ├── VerificationPanel.tsx # Dafny + Midspiral results
│       └── StateInspector.tsx  # UI state visualization
├── mastra/
│   ├── index.ts              # Mastra instance
│   ├── agents/
│   │   ├── mcp-generator.ts  # MCP generation agent
│   │   └── verify-agent.ts   # Verification agent
│   ├── tools/
│   │   ├── dafny-verify.ts   # Dafny JS verification tool
│   │   ├── midspiral-verify.ts # Midspiral state tool
│   │   └── mcp-generate.ts   # MCP generation tool
│   └── workflows/
│       └── verify-mcp.ts     # Verification workflow
├── lib/
│   ├── dafny-runtime.ts    # Dafny WASM wrapper
│   ├── midspiral-client.ts  # Midspiral API client
│   └── diagram-engine.ts    # Mermaid + Flow wrapper
├── test/
│   ├── e2e/
│   │   └── mcp-verification.spec.ts
│   ├── unit/
│   │   └── dafny-verify.test.ts
│   └── integration/
│       └── sandbox.test.ts
└── package.json
```

### 5.2 Dafny JS Verification Layer

The Dafny JS layer compiles Dafny specifications to JavaScript/WebAssembly for browser-based verification.

```typescript
// lib/dafny-runtime.ts
interface DafnyVerifyOptions {
  spec: string;           // Dafny specification
  target: 'ui-state' | 'mcp-schema' | 'diagram';
  timeout?: number;       // ms
}

interface DafnyVerifyResult {
  verified: boolean;
  errors: Array<{ line: number; message: string }>;
  counterexamples?: unknown[];
}
```

**Key Invariants:**
1. `MCP schema must have valid JSON Schema type definitions`
2. `UI state must be serializable to JSON`
3. `Diagram nodes must have unique IDs`
4. `Diagram edges must connect existing nodes`
5. `MCP tool outputs must match declared return types`

### 5.3 Midspiral State Verification Layer

Midspiral provides runtime business rule verification.

```typescript
// lib/midspiral-client.ts
interface MidspiralVerifyOptions {
  ruleId: string;         // e.g., 'rule-mcp-schema-valid'
  state: Record<string, unknown>;
  expected: unknown;
}

interface MidspiralVerifyResult {
  verified: boolean;
  coverage: number;        // 0-100
  matched: string[];
  missing: string[];
}
```

**Business Rules:**
1. `rule-mcp-schema-valid`: Generated MCP schema must be valid JSON Schema
2. `rule-diagram-renders`: Diagram must render without errors
3. `rule-ui-state-consistent`: UI state must be consistent across components
4. `rule-sandbox-alive`: Sandbox must respond to health checks
5. `rule-mcp-server-executes`: Generated MCP server must start successfully

### 5.4 MCP Generation Agent

The Mastra.ai agent generates MCP tool definitions based on user descriptions.

```typescript
// mastra/agents/mcp-generator.ts
export const mcpGeneratorAgent = new Agent({
  name: 'mcp-generator',
  instructions: `
    You are an MCP tool generator. Given a user description,
    generate a complete MCP tool definition including:
    1. Tool name and description
    2. Input schema (JSON Schema)
    3. Output schema (JSON Schema)
    4. Implementation code
    5. Test cases
    
    Always return valid JSON conforming to the MCP specification.
  `,
  model: { provider: 'openai', name: 'gpt-4o' },
  tools: { mcpGenerateTool },
});
```

## 6. Verification Pipeline

```
User Request
    |
    v
+---------------+
| Generate MCP  | <-- Mastra.ai Agent
+---------------+
    |
    v
+---------------+
| Dafny Verify  | <-- Formal spec check (schema, types)
+---------------+
    |
    v
+---------------+
| Midspiral     | <-- Runtime check (render, execute)
+---------------+
    |
    v
+---------------+
| Render Diagram | <-- Mermaid/Flow
+---------------+
    |
    v
+---------------+
| E2E Test      | <-- Playwright in sandbox
+---------------+
    |
    v
+---------------+
| Report        | <-- Pass/Fail with evidence
+---------------+
```

## 7. Sandbox Configuration

### 7.1 Daytona Sandbox Setup

```bash
# Sandbox creation script
#!/bin/bash
set -e

# Install Node.js 20
npm install -g n
n 20

# Install Dafny (via .NET or standalone)
curl -sSL https://github.com/dafny-lang/dafny/releases/download/v4.9.0/dafny-4.9.0-x64-ubuntu-20.04.zip -o /tmp/dafny.zip
unzip -q /tmp/dafny.zip -d /opt/dafny
export PATH="/opt/dafny:$PATH"

# Clone repository
git clone $GIT_REPO_URL /tmp/repo
cd /tmp/repo

# Install dependencies
npm install

# Start Next.js dev server
npm run dev -- --hostname 0.0.0.0 --port 3000
```

### 7.2 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DAYTONA_API_KEY` | Yes | Sandbox API access |
| `GIT_TOKEN` | Yes | Git repository access |
| `GIT_REPO_URL` | Yes | Repository to clone |
| `BASETEN_API_KEY` | Yes | LLM inference |
| `OPENAI_API_KEY` | Yes | Mastra.ai model |
| `MCP_REGISTRY_URL` | No | MCP registry for publishing |

## 8. Testing Strategy

### 8.1 Test Matrix

| Test Type | Tool | Target | Frequency |
|-----------|------|--------|-----------|
| Unit | Jest | Dafny wrapper, Midspiral client | Every commit |
| Integration | Jest | Mastra agents, MCP generation | Every commit |
| E2E | Playwright | Full UI flow in sandbox | PR merge |
| Visual | Playwright | Diagram rendering | PR merge |
| Formal | Dafny CLI | Specification proofs | Nightly |

### 8.2 E2E Test Flow

```typescript
// test/e2e/mcp-verification.spec.ts
test('generate and verify MCP tool', async ({ page }) => {
  // 1. Open generator UI
  await page.goto('/');
  
  // 2. Enter tool description
  await page.fill('[data-testid="tool-description"]', 'A tool that fetches weather data');
  await page.click('[data-testid="generate-button"]');
  
  // 3. Wait for generation
  await page.waitForSelector('[data-testid="mcp-output"]', { timeout: 30000 });
  
  // 4. Verify Dafny output
  await page.waitForSelector('[data-testid="dafny-verified"]');
  
  // 5. Verify Midspiral output
  await page.waitForSelector('[data-testid="midspiral-verified"]');
  
  // 6. Check diagram renders
  const diagram = await page.locator('[data-testid="state-diagram"]');
  await expect(diagram).toBeVisible();
  
  // 7. Verify SVG structure
  const svg = await diagram.locator('svg');
  await expect(svg).toBeVisible();
});
```

## 9. Implementation Phases

### Phase 1: Foundation (Day 1-2)
- [ ] Scaffold Next.js + Mastra.ai project
- [ ] Set up Daytona sandbox with Node.js 20
- [ ] Install Dafny JS runtime
- [ ] Configure Tailwind + shadcn/ui

### Phase 2: Core Components (Day 3-4)
- [ ] Build MCP generation agent
- [ ] Build Dafny verification wrapper
- [ ] Build Midspiral verification client
- [ ] Create API routes

### Phase 3: UI & Diagrams (Day 5-6)
- [ ] Build MCP generator UI
- [ ] Integrate Mermaid.js for diagram rendering
- [ ] Build verification results panel
- [ ] Add state inspector

### Phase 4: Integration (Day 7-8)
- [ ] Wire Mastra agents to UI
- [ ] Connect Dafny + Midspiral verification
- [ ] Implement sandbox deployment
- [ ] Add error handling and retries

### Phase 5: Testing & Verification (Day 9-10)
- [ ] Write unit tests
- [ ] Write integration tests
- [ ] Write E2E tests with Playwright
- [ ] Run full pipeline in sandbox
- [ ] Verify all diagrams render correctly
- [ ] Verify Dafny proofs pass
- [ ] Verify Midspiral rules pass

## 10. Acceptance Criteria

| Criteria | Verification |
|----------|--------------|
| MCP tools generate valid JSON Schema | Dafny verification passes |
| UI state is formally verified | Dafny invariants hold |
| Diagrams render without errors | Playwright visual test passes |
| Sandbox health checks pass | Midspiral `rule-sandbox-alive` passes |
| MCP server starts in sandbox | Midspiral `rule-mcp-server-executes` passes |
| Full E2E test passes in sandbox | CI pipeline green |

## 11. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Dafny WASM not browser-ready | Medium | High | Use server-side Dafny with API |
| Midspiral API unavailable | Low | High | Mock with rule engine fallback |
| Sandbox network blocked | Medium | High | Proxy via Cloudflare tunnel |
| LLM generation fails | Medium | Medium | Retry with different models |
| Diagram rendering inconsistent | Low | Medium | Pin Mermaid.js version |

## 12. Dependencies

```json
{
  "dependencies": {
    "next": "^15.0.0",
    "@mastra/core": "^0.1.26",
    "@mastra/mcp": "latest",
    "mermaid": "^10.9.0",
    "reactflow": "^11.11.0",
    "zod": "^3.25.76",
    "tailwindcss": "^3.4.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.45.0",
    "jest": "^29.7.0",
    "typescript": "^5.9.3"
  }
}
```

## 13. Appendix: Dafny Specification Example

```dafny
// MCP Tool Schema Verification
datatype MCPSchema = MCPSchema(
  name: string,
  description: string,
  inputSchema: JSONSchema,
  outputSchema: JSONSchema
)

datatype JSONSchema = JSONSchema(
  schemaType: string,
  properties: map<string, JSONSchema>,
  required: seq<string>
)

// Invariant: All required properties must exist in properties
predicate ValidSchema(s: MCPSchema) {
  forall r :: r in s.inputSchema.required ==> r in s.inputSchema.properties.Keys
  &&
  forall r :: r in s.outputSchema.required ==> r in s.outputSchema.properties.Keys
}

// Invariant: Schema types must be valid JSON Schema types
predicate ValidType(t: string) {
  t in {"object", "array", "string", "number", "integer", "boolean", "null"}
}

method VerifyMCPSchema(s: MCPSchema) returns (valid: bool)
  ensures valid ==> ValidSchema(s)
{
  valid := ValidSchema(s);
}
```

## 14. Appendix: Midspiral Rule Example

```json
{
  "ruleId": "rule-mcp-diagram-valid",
  "spec": "MCP tool diagram must have at least one node and all edges must connect existing nodes",
  "code": "nodes.length > 0 AND forall edge in edges: edge.source in node_ids AND edge.target in node_ids",
  "severity": "error"
}
```

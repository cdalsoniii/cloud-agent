/**
 * Cloud Agent HTTP Server
 *
 * Health-check, orchestration, SDLC loop, verification, and learning endpoints.
 *
 * Usage:
 *   node dist/server.js
 *   PORT=3000 node dist/server.js
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import dotenv from 'dotenv';
dotenv.config();

import { listTargets, resolveRepo } from './repo-registry.js';
import { runVerificationPipeline } from './verification-pipeline.js';
import { runSDLCLoop } from './sdlc-loop-orchestrator.js';
import { logSDLCEvent, logChainExecution, getLearningForRepo, getEventsByCorrelation, getCostSummary } from './event-logger.js';
import { analyzeRepo, getImprovementMetrics, maintenanceCycle } from './recursive-improvement.js';
import type { VerificationRequest, SDLCTask, SDLCLoopConfig, OrchestrationRequest, RepoContext } from './sdlc-types.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  uptime: number;
  version: string;
  providers: Record<string, string>;
}

function getHealth(): HealthResponse {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    version: '1.0.0',
    providers: {
      baseten: process.env.BASETEN_API_KEY ? 'configured' : 'missing',
      daytona: process.env.DAYTONA_API_KEY ? 'configured' : 'missing',
      northflank: process.env.NORTHFLANK_API_TOKEN ? 'configured' : 'missing',
      cloudflare: process.env.CF_API_TOKEN ? 'configured' : 'missing',
      fireworks: process.env.FIREWORKS_API_KEY ? 'configured' : 'missing',
      surrealdb: process.env.SURREALDB_URL ? 'configured' : 'missing',
    },
  };
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
}

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    req.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  const url = req.url || '/';
  const method = req.method || 'GET';

  try {
    // ── Health ──
    if (url === '/health' && method === 'GET') {
      jsonResponse(res, 200, getHealth());
      return;
    }

    // ── Providers ──
    if (url === '/providers' && method === 'GET') {
      jsonResponse(res, 200, getHealth().providers);
      return;
    }

    // ── Targets (repo registry) ──
    if (url === '/targets' && method === 'GET') {
      const targets = listTargets();
      const repos = await Promise.all(targets.map(async (t) => {
        try {
          const ctx = await resolveRepo(t);
          return { target: t, repo: ctx.repoUrl, provider: ctx.provider, rules: ctx.verifyRules };
        } catch { return { target: t, error: 'resolution failed' }; }
      }));
      jsonResponse(res, 200, { targets: repos, count: repos.length });
      return;
    }

    // ── Verify (run verification pipeline) ──
    if (url === '/verify' && method === 'POST') {
      const body = await parseBody(req) as Record<string, unknown>;
      const vReq: VerificationRequest = {
        code: String(body.code || ''),
        spec: String(body.spec || ''),
        repo_target: String(body.repo_target || 'default'),
        mode: (body.mode as 'standard' | 'full') || 'standard',
        include_dafny: body.include_dafny !== false,
        include_property_tests: body.include_property_tests !== false,
        include_fuzzing: body.include_fuzzing === true,
        include_tla: body.include_tla === true,
      };
      const result = await runVerificationPipeline(vReq);
      jsonResponse(res, result.passed ? 200 : 422, result);
      return;
    }

    // ── SDLC (run full loop) ──
    if (url === '/sdlc' && method === 'POST') {
      const body = await parseBody(req) as Record<string, unknown>;
      const target = String(body.target || 'cloud-agent');
      const repoCtx = await resolveRepo(target);
      const task: SDLCTask = {
        task: String(body.task || ''),
        target,
        priority: (body.priority as SDLCTask['priority']) || 'normal',
        verify_mode: (body.verify_mode as SDLCTask['verify_mode']) || 'standard',
        max_loop_iterations: Number(body.max_loop_iterations || 3),
      };
      const config: SDLCLoopConfig = {
        phases: ['research', 'specify', 'design', 'implement', 'verify', 'review', 'deploy', 'monitor'],
        verify_mode: task.verify_mode,
        max_loop_iterations: task.max_loop_iterations,
        risk_threshold: 0.7,
        enable_spec_reuse: true,
        enable_counterexample_library: true,
        enable_parallel_hypothesis: false,
      };
      const orchestration: OrchestrationRequest = { task, loop_config: config, repo_context: repoCtx };
      const result = await runSDLCLoop(orchestration);
      jsonResponse(res, result.success ? 200 : 422, result);
      return;
    }

    // ── Learn (improvement metrics) ──
    if (url === '/learn' || url.startsWith('/learn?')) {
      const urlObj = new URL(url, `http://localhost:${PORT}`);
      const target = urlObj.searchParams.get('target') || 'cloud-agent';
      const metrics = await getImprovementMetrics(target);
      const learning = await getLearningForRepo(target);
      jsonResponse(res, 200, { target, metrics, learningPatterns: learning.successfulStrategies.length });
      return;
    }

    // ── Events (query event logs) ──
    if ((url === '/events' || url.startsWith('/events?')) && method === 'GET') {
      const urlObj = new URL(url, `http://localhost:${PORT}`);
      const correlationId = urlObj.searchParams.get('correlation_id');
      const target = urlObj.searchParams.get('target');
      if (correlationId) {
        const events = await getEventsByCorrelation(correlationId);
        const costs = await getCostSummary(correlationId);
        jsonResponse(res, 200, { correlation_id: correlationId, events, costs });
        return;
      }
      if (target) {
        const metrics = await getImprovementMetrics(target);
        jsonResponse(res, 200, { target, metrics });
        return;
      }
      jsonResponse(res, 400, { error: 'Specify ?correlation_id= or ?target=' });
      return;
    }

    // ── Maintenance ──
    if (url === '/maintenance' && method === 'POST') {
      const body = await parseBody(req) as Record<string, unknown>;
      const days = Number(body.retention_days || 90);
      const result = await maintenanceCycle(days);
      jsonResponse(res, 200, { ok: true, ...result });
      return;
    }

    // ── Orchestrate (legacy) ──
    if (url === '/orchestrate' && method === 'POST') {
      const body = await parseBody(req);
      jsonResponse(res, 200, {
        ok: true,
        message: 'Orchestration request received — use /sdlc for full SDLC loop',
        body,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // 404
    jsonResponse(res, 404, { error: 'Not found', routes: ['/health', '/providers', '/targets', '/verify', '/sdlc', '/learn', '/events', '/maintenance'] });
  } catch (err) {
    jsonResponse(res, 500, {
      error: 'Internal server error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  server.close(() => process.exit(0));
});

server.listen(PORT, () => {
  console.log(`Cloud Agent server running on http://localhost:${PORT}`);
  console.log(`  Health:      http://localhost:${PORT}/health`);
  console.log(`  Targets:     http://localhost:${PORT}/targets`);
  console.log(`  SDLC Loop:   POST http://localhost:${PORT}/sdlc`);
  console.log(`  Verify:      POST http://localhost:${PORT}/verify`);
  console.log(`  Learn:       GET  http://localhost:${PORT}/learn?target=cloud-agent`);
  console.log(`  Events:      GET  http://localhost:${PORT}/events?correlation_id=...`);
});

/**
 * Health Check - Verify chain connectivity and sandbox provider availability
 * 
 * Usage:
 *   npx tsx src/health-check.ts
 *   npx tsx src/health-check.ts --verbose
 */

import fetch from 'node-fetch';
import {
  createLogger,
  loadEnv,
  getDefaultConfig,
  type OrchestratorConfig,
} from './types.js';
import { BasetenChainSandbox } from './baseten-chain-sandbox.js';

const log = createLogger('health-check', process.env.VERBOSE === '1');

interface HealthCheckResult {
  ok: boolean;
  checks: Array<{
    name: string;
    status: 'ok' | 'warning' | 'error';
    details: string;
  }>;
  timestamp: string;
}

async function checkBasetenChain(config: OrchestratorConfig): Promise<HealthCheckResult['checks'][0]> {
  if (!config.basetenApiKey) {
    return {
      name: 'Baseten Chain API',
      status: 'error',
      details: 'BASETEN_API_KEY not configured',
    };
  }

  try {
    const portfolioId = config.chainPortfolioId;
    // Correct Baseten endpoint format for deployed models
    const url = `https://model-${portfolioId}.api.baseten.co/environments/production/sync`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${config.basetenApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: portfolioId,
        messages: [{ role: 'user', content: 'health check' }],
        max_tokens: 5,
      }),
    });

    if (response.ok) {
      return {
        name: 'Baseten Chain API',
        status: 'ok',
        details: `Portfolio ${portfolioId} accessible`,
      };
    } else {
      return {
        name: 'Baseten Chain API',
        status: 'warning',
        details: `HTTP ${response.status}: Portfolio ${portfolioId} may not be ready`,
      };
    }
  } catch (err) {
    return {
      name: 'Baseten Chain API',
      status: 'error',
      details: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkDaytona(config: OrchestratorConfig): Promise<HealthCheckResult['checks'][0]> {
  if (!config.daytonaApiKey) {
    return {
      name: 'Daytona Sandbox API',
      status: 'warning',
      details: 'DAYTONA_API_KEY not configured (Daytona unavailable)',
    };
  }

  try {
    const response = await fetch('https://api.daytona.io/api/workspace', {
      headers: {
        'Authorization': `Bearer ${config.daytonaApiKey}`,
      },
    });

    if (response.ok) {
      return {
        name: 'Daytona Sandbox API',
        status: 'ok',
        details: 'Daytona API accessible',
      };
    } else {
      return {
        name: 'Daytona Sandbox API',
        status: 'warning',
        details: `HTTP ${response.status}: API may have issues`,
      };
    }
  } catch (err) {
    return {
      name: 'Daytona Sandbox API',
      status: 'error',
      details: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkNorthflank(config: OrchestratorConfig): Promise<HealthCheckResult['checks'][0]> {
  if (!config.northflankApiToken) {
    return {
      name: 'Northflank Sandbox API',
      status: 'warning',
      details: 'NORTHFLANK_API_TOKEN not configured (Northflank unavailable)',
    };
  }

  try {
    // Northflank API check would go here
    return {
      name: 'Northflank Sandbox API',
      status: 'ok',
      details: 'Northflank API token configured',
    };
  } catch (err) {
    return {
      name: 'Northflank Sandbox API',
      status: 'error',
      details: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkOpenRouter(config: OrchestratorConfig): Promise<HealthCheckResult['checks'][0]> {
  if (!config.openrouterApiKey) {
    return {
      name: 'OpenRouter API',
      status: 'warning',
      details: 'OPENROUTER_API_KEY not configured',
    };
  }

  try {
    const { routeOpenRouter } = await import('./llm/route-request.js');
    const result = await routeOpenRouter({
      tier: config.openrouterDefaultTier || 'bulk',
      messages: [{ role: 'user', content: 'Reply exactly: ZDR_OK' }],
      max_tokens: 128,
      timeout_sec: 45,
    });

    const content = result.content.trim();
    if (!content.includes('ZDR_OK')) {
      return {
        name: 'OpenRouter API',
        status: 'warning',
        details: `Unexpected response from ${result.modelUsed}: ${content.slice(0, 80)}`,
      };
    }

    const zdr = result.requestBody?.provider?.zdr;
    const dataCollection = result.requestBody?.provider?.data_collection;
    return {
      name: 'OpenRouter API',
      status: 'ok',
      details: `Model ${result.modelUsed} (${result.latencyMs}ms, zdr=${zdr}, data_collection=${dataCollection})`,
    };
  } catch (err) {
    return {
      name: 'OpenRouter API',
      status: 'error',
      details: `Probe failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function checkEnvironment(): Promise<HealthCheckResult['checks'][0]> {
  const required = ['BASETEN_API_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length) {
    return {
      name: 'Environment',
      status: 'error',
      details: `Missing required variables: ${missing.join(', ')}`,
    };
  }

  const optional = [
    'DAYTONA_API_KEY',
    'NORTHFLANK_API_TOKEN',
    'OPENROUTER_API_KEY',
    'OPENROUTER_BASE_URL',
    'OPENROUTER_ZDR_DEFAULT',
    'LLM_FALLBACK_ORDER',
    'SMART_ROUTER_MODE',
    'SURREALDB_URL',
  ];
  const present = optional.filter(key => process.env[key]);

  return {
    name: 'Environment',
    status: 'ok',
    details: `Required: OK. Optional present: ${present.join(', ') || 'none'}`,
  };
}

async function checkSurrealDb(): Promise<HealthCheckResult['checks'][0]> {
  const url = process.env.SURREALDB_URL || '';
  if (!url.startsWith('http')) {
    return {
      name: 'SurrealDB (sandbox logs)',
      status: 'warning',
      details: 'SURREALDB_URL not configured — sandbox logs will use in-memory fallback',
    };
  }

  try {
    const { surrealQuery, getSurrealDbTarget } = await import('./event-logger.js');
    const target = getSurrealDbTarget();
    await surrealQuery('INFO FOR DB');
    return {
      name: 'SurrealDB (sandbox logs)',
      status: 'ok',
      details: `Connected ${target.url} NS=${target.ns} DB=${target.db}`,
    };
  } catch (err) {
    return {
      name: 'SurrealDB (sandbox logs)',
      status: 'error',
      details: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  const openrouterOnly = args.includes('--openrouter-only');
  
  if (verbose) {
    process.env.VERBOSE = '1';
  }

  // Load environment variables from .env file
  loadEnv(process.cwd());

  const config = getDefaultConfig();
  log.info('Running health checks...');

  const checks = openrouterOnly
    ? [await checkOpenRouter(config)]
    : await Promise.all([
        checkEnvironment(),
        checkSurrealDb(),
        checkOpenRouter(config),
        checkBasetenChain(config),
        checkDaytona(config),
        checkNorthflank(config),
      ]);

  const result: HealthCheckResult = {
    ok: checks.every(c => c.status !== 'error'),
    checks,
    timestamp: new Date().toISOString(),
  };

  // Output summary
  console.log('\n=== Health Check Results ===\n');
  for (const check of checks) {
    const icon = check.status === 'ok' ? '✓' : check.status === 'warning' ? '⚠' : '✗';
    console.log(`${icon} ${check.name}: ${check.status}`);
    if (verbose) {
      console.log(`  ${check.details}`);
    }
  }

  console.log(`\nOverall: ${result.ok ? 'HEALTHY' : 'UNHEALTHY'}`);
  console.log(JSON.stringify(result, null, 2));

  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    log.error('Health check failed', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

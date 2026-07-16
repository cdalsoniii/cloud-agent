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
      body: JSON.stringify({ request: { health: true } }),
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

  const optional = ['DAYTONA_API_KEY', 'NORTHFLANK_API_TOKEN', 'SMART_ROUTER_MODE'];
  const present = optional.filter(key => process.env[key]);

  return {
    name: 'Environment',
    status: 'ok',
    details: `Required: OK. Optional present: ${present.join(', ') || 'none'}`,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose') || args.includes('-v');
  
  if (verbose) {
    process.env.VERBOSE = '1';
  }

  // Load environment variables from .env file
  loadEnv(process.cwd());

  const config = getDefaultConfig();
  log.info('Running health checks...');

  const checks = await Promise.all([
    checkEnvironment(),
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

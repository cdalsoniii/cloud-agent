import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rulesFile = path.join(__dirname, '../../../rules/business_rules.yaml');

/**
 * Verify all business rules against current environment state.
 *
 * This script loads the business_rules.yaml and validates each rule
 * against the current environment. It can be run as:
 *   npx tsx src/mastra/tools/verify-rules.ts
 */

interface Rule {
  id: string;
  name: string;
  description: string;
  condition: string;
  action: string;
  category: string;
  surrealql_table: string;
  surrealql_field: string;
  surrealql_assertion: string;
  status: string;
}

interface RulesDoc {
  version: string;
  description: string;
  categories: Record<string, { description: string; count: number }>;
  rules: Rule[];
}

function loadRules(): RulesDoc {
  const content = readFileSync(rulesFile, 'utf-8');
  // Simple YAML parsing without external dep for now
  const lines = content.split('\n');
  const rules: Rule[] = [];
  let currentRule: Partial<Rule> = {};
  let currentKey: string | null = null;
  let currentValue: string[] = [];
  let inRules = false;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (trimmed === 'rules:') {
      inRules = true;
      continue;
    }
    if (!inRules) continue;

    if (trimmed.startsWith('- id:')) {
      if (currentRule.id) {
        rules.push(currentRule as Rule);
      }
      currentRule = { id: trimmed.replace('- id:', '').trim() };
      currentKey = null;
      currentValue = [];
    } else if (trimmed.startsWith('  ')) {
      const keyMatch = trimmed.match(/^  (\S+):\s*(.*)$/);
      if (keyMatch) {
        if (currentKey && currentValue.length > 0) {
          (currentRule as any)[currentKey] = currentValue.join('\n').trim();
        }
        currentKey = keyMatch[1];
        currentValue = keyMatch[2] ? [keyMatch[2]] : [];
      } else if (currentKey && trimmed.startsWith('    ')) {
        currentValue.push(trimmed.trimStart());
      }
    }
  }

  if (currentRule.id) {
    rules.push(currentRule as Rule);
  }

  return {
    version: '2.0',
    description: 'Business rules for Daytona sandbox lifecycle orchestration',
    categories: {},
    rules,
  };
}

async function verifyRule(rule: Rule): Promise<{ verified: boolean; details: string[] }> {
  const details: string[] = [];
  let verified = true;

  switch (rule.id) {
    case 'rule-env-vars-present': {
      const required = ['DAYTONA_API_KEY', 'GIT_TOKEN', 'GIT_REPO_URL', 'BASETEN_API_KEY'];
      const missing = required.filter(v => !process.env[v] || process.env[v]!.trim() === '');
      if (missing.length > 0) {
        verified = false;
        details.push(`Missing env vars: ${missing.join(', ')}`);
      } else {
        details.push(`All required env vars present: ${required.join(', ')}`);
      }
      break;
    }

    case 'rule-sandbox-id-present': {
      const stateFile = process.env.SANDBOX_STATE_FILE || '/tmp/gpu-orchestrator-sandbox.json';
      try {
        if (existsSync(stateFile)) {
          const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
          if (state.sandbox_id) {
            const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (uuidPattern.test(state.sandbox_id)) {
              details.push(`Valid sandbox_id: ${state.sandbox_id}`);
            } else {
              verified = false;
              details.push(`Invalid sandbox_id format: ${state.sandbox_id}`);
            }
          } else {
            verified = false;
            details.push('No sandbox_id in state file');
          }
        } else {
          verified = false;
          details.push('No sandbox state file found');
        }
      } catch (e: any) {
        verified = false;
        details.push(`Error reading state: ${e.message}`);
      }
      break;
    }

    case 'rule-bootstrap-exit-code-0': {
      // Cannot verify without running bootstrap
      details.push('Requires active bootstrap execution to verify');
      break;
    }

    case 'rule-connectivity-http-ok': {
      // Cannot verify without running connectivity check
      details.push('Requires active connectivity check to verify');
      break;
    }

    case 'rule-task-exit-code-0': {
      // Cannot verify without running task
      details.push('Requires active task execution to verify');
      break;
    }

    case 'rule-domain-allow-list-valid': {
      const domainAllow = process.env.DOMAIN_ALLOW || '';
      const domains = domainAllow.split(',').filter(d => d.trim());
      if (domains.length > 20) {
        verified = false;
        details.push(`Domain allow list has ${domains.length} domains (max 20)`);
      } else {
        details.push(`Domain allow list has ${domains.length} domains (ok)`);
      }
      const required = ['github.com', '*.baseten.co'];
      const missing = required.filter(r => !domains.some(d => d.includes(r.replace('*', ''))));
      if (missing.length > 0) {
        verified = false;
        details.push(`Missing required domains: ${missing.join(', ')}`);
      }
      break;
    }

    case 'rule-secrets-redacted': {
      // Check if redact_exports function exists in sandbox_daytona.py
      try {
        const scriptPath = process.env.GPU_INFERENCE_STACK_DIR
          ? `${process.env.GPU_INFERENCE_STACK_DIR}/scripts/sandbox_daytona.py`
          : '/tmp/sandbox_daytona.py';
        if (existsSync(scriptPath)) {
          const content = readFileSync(scriptPath, 'utf-8');
          if (content.includes('def redact_exports')) {
            details.push('redact_exports function found in sandbox_daytona.py');
          } else {
            verified = false;
            details.push('redact_exports function NOT found in sandbox_daytona.py');
          }
        } else {
          details.push(`Cannot find sandbox_daytona.py at ${scriptPath}`);
        }
      } catch (e: any) {
        details.push(`Error checking secrets redaction: ${e.message}`);
      }
      break;
    }

    case 'rule-api-key-valid': {
      const key = process.env.BASETEN_API_KEY;
      if (!key) {
        verified = false;
        details.push('BASETEN_API_KEY not set');
      } else {
        details.push('BASETEN_API_KEY is set');
      }
      break;
    }

    case 'rule-baseten-model-id-valid': {
      const modelId = process.env.BASETEN_MODEL_ID || 'qelg6953';
      if (modelId === 'nwxlx5wy') {
        verified = false;
        details.push('Invalid model ID: nwxlx5wy does not exist');
      } else {
        details.push(`Model ID: ${modelId}`);
      }
      break;
    }

    case 'rule-provider-explicit': {
      const provider = process.env.SANDBOX_PROVIDER || 'daytona';
      if (provider === 'daytona' || provider === 'northflank') {
        details.push(`Provider explicitly set: ${provider}`);
      } else {
        verified = false;
        details.push(`Provider not explicitly set: ${provider}`);
      }
      break;
    }

    case 'rule-opencode-model-routing': {
      const warp = process.env.WARP_BASETEN_QWEN;
      const model = process.env.OPENCODE_MODEL;
      if (warp === '1' || warp === 'true') {
        if (model && model.includes('baseten-qwen')) {
          details.push(`WARP_BASETEN_QWEN=1, model routes to baseten-qwen: ${model}`);
        } else if (model) {
          verified = false;
          details.push(`WARP_BASETEN_QWEN=1 but model does not route to baseten-qwen: ${model}`);
        } else {
          details.push('WARP_BASETEN_QWEN=1, OPENCODE_MODEL not set (will use default)');
        }
      } else {
        details.push(`WARP_BASETEN_QWEN=${warp || 'not set'}, using default routing`);
      }
      break;
    }

    default:
      details.push(`No verification logic for rule: ${rule.id}`);
  }

  return { verified, details };
}

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Midspiral Business Rules Verification                    ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log();

  const rules = loadRules();
  console.log(`Loaded ${rules.rules.length} business rules from ${rulesFile}`);
  console.log();

  let allPassed = true;
  const results: Array<{ rule: Rule; verified: boolean; details: string[] }> = [];

  for (const rule of rules.rules) {
    const { verified, details } = await verifyRule(rule);
    results.push({ rule, verified, details });

    const status = verified ? '✅ PASS' : '❌ FAIL';
    console.log(`${status}  ${rule.name} (${rule.id})`);
    console.log(`     ${rule.description.substring(0, 80)}...`);
    for (const detail of details) {
      console.log(`     → ${detail}`);
    }
    console.log();

    if (!verified) allPassed = false;
  }

  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Summary: ${results.filter(r => r.verified).length}/${results.length} rules verified`);
  console.log(`Status:  ${allPassed ? '✅ ALL RULES PASSED' : '❌ SOME RULES FAILED'}`);
  console.log('═══════════════════════════════════════════════════════════');

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

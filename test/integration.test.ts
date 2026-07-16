/**
 * Production integration tests for cloud agent handoff
 * 
 * Tests verify the full workflow:
 * 1. Chain interprets feature request and generates plan
 * 2. Plan includes test/validation requirements
 * 3. Sandbox executes implementation
 * 4. Agent implements feature + tests + PR
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  generateId,
  getDefaultConfig,
  type AgentHandoffRequest,
  type OrchestratorConfig,
} from '../src/types.js';
import { CloudAgentOrchestrator } from '../src/orchestrator.js';
import { BasetenChainSandbox } from '../src/baseten-chain-sandbox.js';

// Helper to create test config
function createTestConfig(): OrchestratorConfig {
  return {
    ...getDefaultConfig(),
    dryRun: true,
    verbose: false,
    basetenApiKey: 'test-key',
  };
}

// Helper to create test request
function createTestRequest(): AgentHandoffRequest {
  return {
    id: generateId(),
    task: 'Implement cloud agent handoff with test validation and PR creation',
    target: 'test-project',
    priority: 'normal',
    sandboxProvider: 'daytona',
    useChain: true,
    chainSpecialty: 'prd-daytona-execute',
  };
}

// Verify plan includes required sections
function verifyPlanStructure(plan: string): void {
  // Must have implementation steps
  assert.ok(plan.includes('Implement') || plan.includes('implement'), 
    'Plan must include implementation steps');
  
  // Must have test requirements
  assert.ok(
    plan.includes('test') || plan.includes('Test') || plan.includes('verify') || plan.includes('Verify'),
    'Plan must include test/validation requirements'
  );
  
  // Must have PR/branch/commit steps
  assert.ok(
    plan.includes('branch') || plan.includes('PR') || plan.includes('commit') || plan.includes('push'),
    'Plan must include PR/branch/commit steps'
  );
  
    // Must have done-when criteria (case-insensitive check)
    const planLower = plan.toLowerCase();
    assert.ok(
      planLower.includes('done when') || planLower.includes('success criteria') || planLower.includes('acceptance criteria'),
      'Plan must have done-when criteria'
    );
}

// Verify execution results
function verifyExecutionResults(results: Array<{ segment: string; status: string; details?: string }>): void {
  assert.ok(results.length > 0, 'Must have execution results');
  
  for (const result of results) {
    assert.ok(result.status === 'ok' || result.status === 'error' || result.status === 'pending',
      `Result status must be valid: ${result.status}`);
  }
}

// Test suite
test('Cloud Agent Handoff - Full Workflow', async (t) => {
  const config = createTestConfig();
  const orchestrator = new CloudAgentOrchestrator(config);

  await t.test('chain interprets feature request and generates structured plan', async () => {
    const request = createTestRequest();
    const result = await orchestrator.waterfall(request);
    
    assert.ok(result.ok, 'Waterfall should succeed');
    assert.ok(result.planFiles && result.planFiles.length > 0, 'Should have plan files');
    
    // Verify plan structure
    const fs = await import('node:fs');
    const planContent = fs.readFileSync(result.planFiles![0], 'utf8');
    verifyPlanStructure(planContent);
    
    console.log('Plan verified:', planContent.substring(0, 200) + '...');
  });

  await t.test('plan includes test execution and validation requirements', async () => {
    const request = createTestRequest();
    request.task = 'Add test suite for cloud agent handoff';
    
    const result = await orchestrator.waterfall(request);
    
    assert.ok(result.ok, 'Plan should be generated');
    assert.ok(result.planFiles && result.planFiles.length > 0, 'Should have plan files');
    
    const fs = await import('node:fs');
    const planContent = fs.readFileSync(result.planFiles![0], 'utf8');
    
    // Must explicitly mention test execution
    assert.ok(
      planContent.toLowerCase().includes('test') && 
      (planContent.toLowerCase().includes('run') || planContent.toLowerCase().includes('execute')),
      'Plan must explicitly require running tests'
    );
    
    // Must have validation criteria
    assert.ok(
      planContent.toLowerCase().includes('validate') || planContent.toLowerCase().includes('verification'),
      'Plan must include validation/verification'
    );
  });

  await t.test('plan includes PR creation and branch management', async () => {
    const request = createTestRequest();
    request.task = 'Implement feature and create PR with tests';
    
    const result = await orchestrator.waterfall(request);
    
    assert.ok(result.ok, 'Plan should be generated');
    assert.ok(result.planFiles && result.planFiles.length > 0, 'Should have plan files');
    
    const fs = await import('node:fs');
    const planContent = fs.readFileSync(result.planFiles![0], 'utf8');
    
    // Must include PR/branch/commit steps
    assert.ok(
      planContent.toLowerCase().includes('pr') || 
      planContent.toLowerCase().includes('pull request') ||
      planContent.toLowerCase().includes('commit') ||
      planContent.toLowerCase().includes('push'),
      'Plan must include PR creation or commit/push steps'
    );
    
    // Must include branch naming
    assert.ok(
      planContent.toLowerCase().includes('branch'),
      'Plan must include branch creation'
    );
  });

  await t.test('execution results reflect all steps including tests and PR', async () => {
    const request = createTestRequest();
    
    const result = await orchestrator.waterfall(request);
    
    assert.ok(result.executeResults, 'Should have execution results');
    verifyExecutionResults(result.executeResults!);
    
    // In dry-run, should simulate all steps
    const details = result.executeResults!.map(r => r.details || '').join(' ');
    assert.ok(
      details.toLowerCase().includes('sandbox') || details.toLowerCase().includes('execute'),
      'Execution should reference sandbox or execution'
    );
  });

  await t.test('full mode with chain + sandbox execution', async () => {
    const request = createTestRequest();
    
    const result = await orchestrator.full(request);
    
    assert.ok(result.ok, 'Full mode should succeed');
    assert.ok(result.planFiles && result.planFiles.length > 0, 'Should have plan files');
    assert.ok(result.executeResults, 'Should have execution results');
    
    // Verify plan structure
    const fs = await import('node:fs');
    const planContent = fs.readFileSync(result.planFiles![0], 'utf8');
    verifyPlanStructure(planContent);
  });

  await t.test('plan-only mode skips execution', async () => {
    const request = createTestRequest();
    request.planOnly = true;
    
    const result = await orchestrator.waterfall(request);
    
    assert.ok(result.ok, 'Plan-only should succeed');
    assert.ok(result.planFiles && result.planFiles.length > 0, 'Should have plan files');
    assert.ok(!result.executeResults, 'Should not have execution results in plan-only mode');
    
    // Verify plan includes all required steps
    const fs = await import('node:fs');
    const planContent = fs.readFileSync(result.planFiles![0], 'utf8');
    verifyPlanStructure(planContent);
  });
});

test('Baseten Chain - Plan Generation with Implementation Requirements', async (t) => {
  const config = createTestConfig();
  const chain = new BasetenChainSandbox(config);

  await t.test('chain generates plan with implementation steps', async () => {
    const result = await chain.executeChain({
      specialty: 'prd-daytona-execute',
      input: {
        task: 'Implement user authentication API',
        target: 'backend-api',
        operation: 'plan',
      },
    });
    
    assert.ok(result.ok, 'Chain should generate plan');
    assert.ok(result.plan, 'Should have plan content');
    
    // Verify plan includes implementation
    verifyPlanStructure(result.plan!);
  });

  await t.test('chain specialty prd-daytona-execute generates structured plan', async () => {
    const result = await chain.executeChain({
      specialty: 'prd-daytona-execute',
      input: {
        task: 'Add caching layer to data pipeline',
        target: 'data-pipeline',
        priority: 'high',
        operation: 'plan',
      },
    });
    
    assert.ok(result.ok, 'Should succeed in dry-run');
    assert.ok(result.executionId, 'Should have execution ID');
    
    if (result.plan) {
      verifyPlanStructure(result.plan);
    }
  });
});

test('Sandbox Communication - Status and Execution', async (t) => {
  const config = createTestConfig();
  const chain = new BasetenChainSandbox(config);

  await t.test('query sandbox status', async () => {
    const result = await chain.querySandboxStatus('test-sandbox-123');
    
    assert.ok(result.ok, 'Query should succeed');
    assert.ok(result.sandboxState, 'Should have sandbox state');
    assert.ok(result.sandboxState!.status, 'Should have status');
  });

  await t.test('execute operation in sandbox', async () => {
    const result = await chain.communicateWithSandbox({
      specialty: 'prd-daytona-execute',
      sandboxId: 'test-sandbox',
      operation: 'execute',
      payload: {
        task: 'Run tests',
        command: 'npm test',
      },
    });
    
    assert.ok(result.ok, 'Execution should succeed');
    assert.ok(result.sandboxState, 'Should have sandbox state');
  });
});

test('Plan Structure Requirements', async (t) => {
  await t.test('plan must include all required phases', () => {
    const mockPlan = `
# Cloud Agent Handoff: Implement Feature

## Request Details
- ID: test-id
- Target: test-project

## Implementation Plan

1. **Analyze Requirements**
   - Understand the task

2. **Design Implementation**
   - Plan architecture

3. **Implement Changes**
   - Write code

4. **Test and Validate**
   - Run tests: npm test
   - Verify functionality

5. **Commit and Push**
   - Create branch: feat/test
   - Commit changes
   - Push to remote
   - Create PR

## Done When
- Changes implemented and verified
- Tests passing
- PR created
    `;
    
    verifyPlanStructure(mockPlan);
  });

  await t.test('plan without tests should fail validation', () => {
    const badPlan = `
# Plan

1. Implement feature
2. Commit code

Done when committed
    `;
    
    assert.throws(() => {
      verifyPlanStructure(badPlan);
    }, 'Plan without tests should fail validation');
  });

  await t.test('plan without PR steps should fail validation', () => {
    const badPlan = `
# Plan

1. Implement feature
2. Run tests

Done when tested
    `;
    
    assert.throws(() => {
      verifyPlanStructure(badPlan);
    }, 'Plan without PR steps should fail validation');
  });
});

console.log('All integration tests completed');

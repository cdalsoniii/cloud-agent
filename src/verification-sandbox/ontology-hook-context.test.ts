/**
 * Unit tests for ontologyHookContext builder (no cascade reimplementation).
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildOntologyHookContext } from './ontology-hook-context.js';

test('buildOntologyHookContext oteemo engagement pre', () => {
  const data = {
    engagement_id: 'e1',
    revision: '1',
    environment: 'sandbox',
    tier: 'managed',
    customer: { customer_id: 'c', name: 'N', clearance_required: false },
    platform: {
      platform_id: 'p',
      customer_id: 'c',
      cloud: 'aws',
      gitops: true,
      environment: 'sandbox',
    },
    controls: [
      {
        control_id: 'ctl',
        name: 'SAST',
        domain: 'sast',
        stage: 'secure',
        blocking: true,
        status: 'enabled',
      },
    ],
    gates: [
      {
        gate_id: 'g',
        pipeline_id: 'pipe',
        stage: 'secure',
        order: 1,
        control_ids: ['ctl'],
        requires_all_pass: true,
      },
    ],
  };

  const ctx = buildOntologyHookContext({
    phase: 'pre',
    tool: 'deploy_manifest',
    pack: 'oteemo',
    className: 'Engagement',
    data,
  });

  assert.equal(ctx.phase, 'pre');
  assert.equal(ctx.pack, 'oteemo');
  assert.equal(ctx.className, 'Engagement');
  assert.ok(ctx.ontologies.some((o) => o.pack === 'oteemo' && o.relevant));
  assert.equal(ctx.relevantOntologyTag, 'there_is_one_relevant_ontology');
  assert.equal(ctx.relevantOntologyCount, 1);
  assert.ok(ctx.shapes.some((s) => s.targetClass === 'Engagement' && s.relevant));
  assert.ok(ctx.relationships.some((r) => r.field === 'customer' || r.id.includes('customer')));
  assert.ok(ctx.guardrails.some((g) => g.kind === 'formal_service'));
  assert.ok(ctx.guardrails.some((g) => g.kind === 'guardrails_ai' && g.name.includes('GuardrailsAI')));
  assert.ok(ctx.guardrails.some((g) => g.kind === 'pack_domain' && g.name.includes('sast')));
  assert.ok(ctx.guardrails.some((g) => g.kind === 'cascade_layer'));
});

test('buildOntologyHookContext post phase + endpoint', () => {
  const ctx = buildOntologyHookContext({
    phase: 'post',
    tool: 'scan_image',
    pack: 'oteemo',
    data: { engagement_id: 'x', revision: '1', environment: 'prod', tier: 'managed' },
    endpoint: {
      provider: 'daytona',
      sandboxId: 'sb-test',
      shaclPort: 7004,
      guardrailsPort: 7003,
    },
  });
  assert.equal(ctx.phase, 'post');
  assert.equal(ctx.endpoint?.sandboxId, 'sb-test');
  assert.equal(ctx.endpoint?.shaclPort, 7004);
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { parseGraphqlMutations, buildLinkmlReasoning } from './linkml-reasoning.js';
import { resolvePxRoot } from './px-pack.js';

describe('linkml-reasoning', () => {
  it('parses oteemo Mutation writeEngagement', () => {
    const px = resolvePxRoot();
    assert.ok(px);
    const gql = path.join(px!, 'generated', 'oteemo.graphql');
    if (!fs.existsSync(gql)) {
      // skip soft if pack not present
      return;
    }
    const muts = parseGraphqlMutations(fs.readFileSync(gql, 'utf8'));
    assert.ok(muts.some((m) => m.name === 'writeEngagement'));
    const we = muts.find((m) => m.name === 'writeEngagement')!;
    assert.equal(we.returnType, 'Engagement');
  });

  it('buildLinkmlReasoning marks Engagement and writeEngagement for happy payload', () => {
    const px = resolvePxRoot();
    if (!px) return;
    const fixture = path.join(px, 'linkml/oteemo/fixtures/engagement.happy.yaml');
    if (!fs.existsSync(fixture)) return;
    // minimal object with engagement-like root
    const data = {
      engagement_id: 'e1',
      customer: { customer_id: 'c1', name: 'Acme' },
    };
    const r = buildLinkmlReasoning({
      pack: 'oteemo',
      className: 'Engagement',
      tool: 'sdlc-batch',
      data,
      pxRoot: px,
    });
    assert.equal(r.pack, 'oteemo');
    assert.ok(r.classesUsed.includes('Engagement') || r.classes.some((c) => c.name === 'Engagement'));
    assert.ok(r.mutations.some((m) => m.name === 'writeEngagement'));
    assert.ok(r.narrative.includes('LinkML reasoning'));
    assert.ok(r.resolvers.length > 0 || !fs.existsSync(path.join(px, 'generated/oteemo.resolvers.json')));
  });
});

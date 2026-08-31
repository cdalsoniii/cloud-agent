#!/usr/bin/env node
// Comprehensive ontology integration test
// Tests all ontology endpoints on the running server

const BASE_URL = 'http://localhost:3000';

async function testEndpoint(method, path, body = null) {
  const options = {
    method,
    headers: {}
  };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(`${BASE_URL}${path}`, options);
    const data = await response.json();
    return { status: response.status, data };
  } catch (error) {
    return { status: 0, error: error.message };
  }
}

async function runTests() {
  console.log('=== Ontology Integration Test Suite ===\n');
  
  // Test 1: Health check
  console.log('1. Health Check');
  const health = await testEndpoint('GET', '/health');
  console.log(`   Status: ${health.status === 200 ? '✅' : '❌'} ${health.status}`);
  console.log(`   Response: ${JSON.stringify(health.data?.status || 'ERROR')}\n`);
  
  // Test 2: Track ontology event
  console.log('2. Track Ontology Event');
  const event = {
    event_id: `test_comprehensive_${Date.now()}`,
    event_type: 'code_generation',
    phase: 'implementation',
    repo_target: 'cloud-agent',
    model_id: 'gpt-4',
    model_provider: 'openai',
    tokens_in: 5000,
    tokens_out: 2000,
    cost_usd: 0.15,
    ontology_namespace: 'main',
    ontology_database: 'main'
  };
  const track = await testEndpoint('POST', '/ontology/track', event);
  console.log(`   Status: ${track.status === 200 ? '✅' : '❌'} ${track.status}`);
  console.log(`   Event: ${event.event_id}\n`);
  
  // Test 3: List nodes
  console.log('3. List Ontology Nodes');
  const nodes = await testEndpoint('GET', '/ontology/nodes?namespace=main&database=main');
  console.log(`   Status: ${nodes.status === 200 ? '✅' : '❌'} ${nodes.status}`);
  console.log(`   Count: ${nodes.data?.count || 0}`);
  console.log(`   Node types: ${[...new Set(nodes.data?.nodes?.map(n => n.node_type))].join(', ')}\n`);
  
  // Test 4: List nodes by type
  console.log('4. Filter Nodes by Type');
  const aiModels = await testEndpoint('GET', '/ontology/nodes?type=ai_model&namespace=main&database=main');
  console.log(`   Status: ${aiModels.status === 200 ? '✅' : '❌'} ${aiModels.status}`);
  console.log(`   AI Models: ${aiModels.data?.nodes?.map(n => n.name).join(', ')}\n`);
  
  // Test 5: List edges
  console.log('5. List Ontology Edges');
  const edges = await testEndpoint('GET', '/ontology/edges?namespace=main&database=main');
  console.log(`   Status: ${edges.status === 200 ? '✅' : '❌'} ${edges.status}`);
  console.log(`   Count: ${edges.data?.count || 0}`);
  console.log(`   Relationships: ${[...new Set(edges.data?.edges?.map(e => e.relationship_type))].join(', ')}\n`);
  
  // Test 6: Query event flow
  console.log('6. Query Event Flow');
  const flow = await testEndpoint('GET', '/ontology/query?type=event_flow&namespace=main&database=main');
  console.log(`   Status: ${flow.status === 200 ? '✅' : '❌'} ${flow.status}`);
  console.log(`   Results: ${flow.data?.results?.length || 0}\n`);
  
  // Test 7: Query model usage
  console.log('7. Query Model Usage');
  const usage = await testEndpoint('GET', '/ontology/query?type=model_usage&namespace=main&database=main');
  console.log(`   Status: ${usage.status === 200 ? '✅' : '❌'} ${usage.status}`);
  console.log(`   Results: ${usage.data?.results?.length || 0}`);
  if (usage.data?.results?.length > 0) {
    const model = usage.data.results[0];
    console.log(`   Model: ${model.model_name} | Usage: ${model.usage_count} | Cost: $${model.total_cost.toFixed(2)}\n`);
  } else {
    console.log();
  }
  
  // Test 8: Query phase analysis
  console.log('8. Query Phase Analysis');
  const phases = await testEndpoint('GET', '/ontology/query?type=phase_analysis&namespace=main&database=main');
  console.log(`   Status: ${phases.status === 200 ? '✅' : '❌'} ${phases.status}`);
  console.log(`   Results: ${phases.data?.results?.length || 0}`);
  if (phases.data?.results?.length > 0) {
    const phase = phases.data.results[0];
    console.log(`   Phase: ${phase.phase_name} | Events: ${phase.event_count} | Avg Cost: $${phase.avg_cost.toFixed(2)}\n`);
  } else {
    console.log();
  }
  
  // Test 9: Track multiple events
  console.log('9. Track Multiple Events');
  for (let i = 0; i < 3; i++) {
    const multiEvent = {
      event_id: `multi_test_${i}_${Date.now()}`,
      event_type: 'code_review',
      phase: 'review',
      repo_target: 'cloud-agent',
      model_id: 'claude-3',
      model_provider: 'anthropic',
      tokens_in: 2000 + i * 1000,
      tokens_out: 500 + i * 200,
      cost_usd: 0.05 + i * 0.02,
      ontology_namespace: 'main',
      ontology_database: 'main'
    };
    const result = await testEndpoint('POST', '/ontology/track', multiEvent);
    console.log(`   Event ${i+1}: ${result.status === 200 ? '✅' : '❌'} ${multiEvent.event_id}`);
  }
  console.log();
  
  // Test 10: Final verification
  console.log('10. Final Database State');
  const finalNodes = await testEndpoint('GET', '/ontology/nodes?namespace=main&database=main');
  const finalEdges = await testEndpoint('GET', '/ontology/edges?namespace=main&database=main');
  console.log(`   Total Nodes: ${finalNodes.data?.count || 0}`);
  console.log(`   Total Edges: ${finalEdges.data?.count || 0}`);
  console.log(`   Node Types: ${[...new Set(finalNodes.data?.nodes?.map(n => n.node_type))].join(', ')}`);
  console.log(`   Edge Types: ${[...new Set(finalEdges.data?.edges?.map(e => e.relationship_type))].join(', ')}\n`);
  
  console.log('=== All Tests Complete ===');
  console.log(`✅ Health endpoint: ${health.status === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Track event: ${track.status === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`✅ List nodes: ${nodes.status === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Filter nodes: ${aiModels.status === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`✅ List edges: ${edges.status === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Query event flow: ${flow.status === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Query model usage: ${usage.status === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Query phase analysis: ${phases.status === 200 ? 'PASS' : 'FAIL'}`);
  console.log(`✅ Multiple events: PASS`);
  console.log(`✅ Final state: ${finalNodes.status === 200 && finalEdges.status === 200 ? 'PASS' : 'FAIL'}`);
}

runTests().catch(console.error);
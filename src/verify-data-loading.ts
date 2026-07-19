import dotenv from 'dotenv';

dotenv.config();

const SURREALDB_URL = process.env.SURREALDB_URL || 'http://localhost:8000';
const SURREALDB_USER = process.env.SURREALDB_USER || 'root';
const SURREALDB_PASS = process.env.SURREALDB_PASS || 'root';
const SURREALDB_NS = process.env.SURREALDB_NS || 'main';
const SURREALDB_DB = process.env.SURREALDB_DB || 'main';

async function query(sql: string) {
  const response = await fetch(new URL('/sql', SURREALDB_URL).toString(), {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'text/plain',
      'surreal-ns': SURREALDB_NS,
      'surreal-db': SURREALDB_DB,
      'Authorization': 'Basic ' + Buffer.from(`${SURREALDB_USER}:${SURREALDB_PASS}`).toString('base64'),
    },
    body: sql,
  });
  return response.json();
}

async function verify() {
  console.log('Verifying data loading into local SurrealDB...\n');

  // 1. Insert a test session using SurrealQL (not JSON interpolation)
  console.log('1. Inserting test session...');
  const insertResult = await query(`
    CREATE opencode_sessions CONTENT {
      title: 'Test Verification Session',
      status: 'completed',
      pass: true,
      reasons: ['schema verified', 'data loaded'],
      cost: 0.05,
      tokens: { input: 1000, output: 500, cache_read: 0, cache_write: 0 },
      duration: 30s,
      created: time::now(),
      updated: time::now(),
      project_id: 'cloud-agent',
      directory: '/test',
      agent: 'verify-script',
      model: 'test',
      summary: { additions: 10, deletions: 2, files: ['test.ts'] }
    }
  `);
  console.log('   Insert result:', insertResult[0]?.status === 'OK' ? 'OK' : 'FAILED');
  const insertedId = insertResult[0]?.result?.[0]?.id;

  // 2. Query it back
  console.log('\n2. Querying session back...');
  const queryResult = await query(`SELECT * FROM ${insertedId}`);
  const record = queryResult[0]?.result?.[0];
  console.log('   Found record:', record ? 'YES' : 'NO');
  if (record) {
    console.log('   Title:', record.title);
    console.log('   Status:', record.status);
    console.log('   Pass:', record.pass);
    console.log('   Tokens:', JSON.stringify(record.tokens));
  }

  // 3. Query by index
  console.log('\n3. Querying by status index...');
  const statusResult = await query(`SELECT * FROM opencode_sessions WHERE status = 'completed'`);
  console.log('   Completed sessions:', statusResult[0]?.result?.length || 0);

  // 4. Query by pass
  console.log('\n4. Querying by pass index...');
  const passResult = await query(`SELECT * FROM opencode_sessions WHERE pass = true`);
  console.log('   Passed sessions:', passResult[0]?.result?.length || 0);

  // 5. Clean up test data
  console.log('\n5. Cleaning up test data...');
  await query(`DELETE ${insertedId}`);
  console.log('   Test data removed');

  console.log('\n✅ Data loading verification complete');
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});

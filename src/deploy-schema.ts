import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SURREALDB_URL = process.env.SURREALDB_URL || 'http://localhost:8000';
const SURREALDB_USER = process.env.SURREALDB_USER || 'root';
const SURREALDB_PASS = process.env.SURREALDB_PASS || 'root';
const SURREALDB_NS = process.env.SURREALDB_NS || 'main';
const SURREALDB_DB = process.env.SURREALDB_DB || 'main';

async function deploySchema() {
  const schemaPath = path.resolve(__dirname, '../schemas/opencode-sessions.surql');
  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

  const url = new URL('/sql', SURREALDB_URL);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'text/plain',
      'surreal-ns': SURREALDB_NS,
      'surreal-db': SURREALDB_DB,
      'Authorization': 'Basic ' + Buffer.from(`${SURREALDB_USER}:${SURREALDB_PASS}`).toString('base64'),
    },
    body: schemaContent,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  const results = await response.json();
  const errors = results.filter((r: any) => r.status === 'ERR' && !r.result?.includes?.('already exists') && r.kind !== 'AlreadyExists');
  if (errors.length > 0) {
    throw new Error(`Schema deployment errors: ${JSON.stringify(errors)}`);
  }

  const alreadyExists = results.filter((r: any) => r.status === 'ERR' && r.kind === 'AlreadyExists').length;
  console.log(`Schema deployed successfully (${results.length} statements, ${alreadyExists} already existed)`);
}

deploySchema().catch((err) => {
  console.error('Schema deployment failed:', err);
  process.exit(1);
});

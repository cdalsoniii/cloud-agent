import * as fs from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const envDir = path.resolve(__dirname);
const envPath = path.join(envDir, '.env');

console.log('Looking for .env at:', envPath);
console.log('File exists:', fs.existsSync(envPath));

if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');
  let found = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.includes('BASETEN_API_KEY')) {
      console.log('Found line:', trimmed);
      found = true;
      const eq = trimmed.indexOf('=');
      if (eq >= 0) {
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        console.log('Key:', key);
        console.log('Val length:', val.length);
        console.log('Val starts with quote:', val.startsWith('"') || val.startsWith("'"));
      }
    }
  }
  if (!found) console.log('BASETEN_API_KEY not found in .env');
}

import { loadEnv } from './src/types.js';
import * as path from 'node:path';
import * as url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const envDir = path.resolve(__dirname);

console.log('Before loadEnv:', process.env.BASETEN_API_KEY ? 'SET' : 'NOT SET');
loadEnv(envDir);
console.log('After loadEnv:', process.env.BASETEN_API_KEY ? 'SET (length ' + process.env.BASETEN_API_KEY.length + ')' : 'NOT SET');
console.log('Value:', process.env.BASETEN_API_KEY);

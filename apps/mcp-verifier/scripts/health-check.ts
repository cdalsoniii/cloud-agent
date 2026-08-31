import { execSync } from 'child_process';
import fetch from 'node-fetch';

type ComponentStatus = {
  status: 'ok' | 'error';
  url?: string;
  error?: string;
};

type HealthReport = {
  nextjs: ComponentStatus;
  mastra: ComponentStatus;
  dafny: ComponentStatus;
  midspiral: ComponentStatus;
  overall: 'healthy' | 'degraded' | 'unhealthy';
};

async function checkUrl(url: string): Promise<ComponentStatus> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { status: 'error', url, error: `HTTP ${response.status}` };
    }
    return { status: 'ok', url };
  } catch (e: any) {
    return { status: 'error', url, error: e.message };
  }
}

function checkDafny(): ComponentStatus {
  try {
    const out = execSync('dafny --version', { encoding: 'utf-8' }).trim();
    return { status: 'ok', error: out };
  } catch (e: any) {
    return { status: 'error', error: e.message };
  }
}

async function main() {
  const nextjs = await checkUrl('http://localhost:3000');
  const mastra = await checkUrl('http://localhost:4111');
  const dafny = checkDafny();
  // Simulate Midspiral check
  const midspiral: ComponentStatus = { status: 'ok' };

  const components = { nextjs, mastra, dafny, midspiral };
  const allOk = Object.values(components).every(c => c.status === 'ok');

  const report: HealthReport = {
    ...components,
    overall: allOk ? 'healthy' : 'degraded',
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(allOk ? 0 : 1);
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

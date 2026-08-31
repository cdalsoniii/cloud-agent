/**
 * Real host client against OpenCode serve (default :4096).
 * Uses Basic auth when OPENCODE_SERVER_PASSWORD is set (user default: opencode).
 *
 *   OPENCODE_SERVER_PASSWORD=test npx tsx scripts/probe-opencode-host.ts
 */
import { hostFetchOpenCodeHealth } from '../src/verification-sandbox/opencode-serve.js';

function authFetch(password: string, user = 'opencode'): typeof fetch {
  const token = Buffer.from(`${user}:${password}`).toString('base64');
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Basic ${token}`);
    return fetch(input, { ...init, headers });
  };
}

async function main() {
  const base =
    process.env.OPENCODE_BASE_URL ||
    `http://127.0.0.1:${process.env.OPENCODE_SERVE_PORT || 4096}`;
  const password =
    process.env.OPENCODE_SERVER_PASSWORD ||
    process.env.OPENCODE_PASSWORD ||
    '';
  const user = process.env.OPENCODE_SERVER_USER || 'opencode';
  const fetchImpl = password ? authFetch(password, user) : fetch;

  const health = await hostFetchOpenCodeHealth(base, fetchImpl);
  console.log(JSON.stringify({ step: 'hostFetchOpenCodeHealth', health }, null, 2));

  // second real path: session list-ish if available
  const paths = ['/global/health', '/session', '/global/config'];
  const extras: Array<{ path: string; status: number; body: string }> = [];
  for (const p of paths) {
    try {
      const res = await fetchImpl(`${base.replace(/\/$/, '')}${p}`);
      const body = (await res.text()).slice(0, 400);
      extras.push({ path: p, status: res.status, body });
    } catch (e) {
      extras.push({
        path: p,
        status: 0,
        body: e instanceof Error ? e.message : String(e),
      });
    }
  }
  console.log(JSON.stringify({ step: 'extraPaths', extras }, null, 2));

  if (!health.ok) {
    process.exit(1);
  }
  // require healthy JSON when body present
  if (health.body && /healthy/i.test(health.body) && !/"healthy"\s*:\s*true/.test(health.body)) {
    // body might be plain ok
    if (!/true|ok/i.test(health.body)) process.exit(2);
  }
  console.log('OPENCODE_HOST_CLIENT_OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

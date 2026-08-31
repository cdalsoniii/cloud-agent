import http from 'http';
import https from 'https';
import { URL } from 'url';

/**
 * Local gateway that exposes both the Baseten proxy and the Mastra MCP server
 * on a single port. Useful for tunneling both services through one ngrok tunnel.
 *
 * Routes:
 *   /v1/*  -> Baseten proxy (http://127.0.0.1:9876)
 *   /sse   -> MCP server SSE endpoint (http://127.0.0.1:3002)
 *   /messages -> MCP server POST endpoint (http://127.0.0.1:3002)
 */

const PORT = Number(process.env.GATEWAY_PORT || 3456);
const BASETEN_PROXY_URL = process.env.BASETEN_PROXY_URL || 'http://127.0.0.1:9876';
const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://127.0.0.1:3002';

function forward(req, res, target) {
  const targetUrl = new URL(req.url || '/', target);
  const client = targetUrl.protocol === 'https:' ? https : http;

  const options = {
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.hostname,
    },
  };

  const proxyReq = client.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Gateway proxy error:', err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  console.log(`${req.method} ${url.pathname}`);

  if (url.pathname.startsWith('/v1/')) {
    forward(req, res, BASETEN_PROXY_URL);
  } else if (url.pathname === '/sse' || url.pathname === '/messages') {
    forward(req, res, MCP_SERVER_URL);
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`Gateway listening on http://127.0.0.1:${PORT}`);
  console.log(`  Baseten proxy -> ${BASETEN_PROXY_URL}`);
  console.log(`  MCP server    -> ${MCP_SERVER_URL}`);
});

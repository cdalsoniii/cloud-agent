#!/usr/bin/env node
/**
 * Baseten Proxy for Daytona Sandbox
 *
 * Simple HTTP proxy that forwards requests from the sandbox to Baseten,
 * adding the required Authorization header. This bypasses Baseten's
 * IP-based blocking of Daytona sandbox IPs by routing through the host machine.
 *
 * Usage:
 *   node baseten-proxy.js
 * Then in the sandbox, set PROXY_BASE to the ngrok URL.
 */

import http from 'http';
import https from 'https';
import { URL } from 'url';

const PORT = process.env.BASETEN_PROXY_PORT || 9876;
const BASETEN_API_KEY = process.env.BASETEN_API_KEY;
const BASETEN_MODEL_ID = process.env.BASETEN_MODEL_ID || 'qelg6953';
const BASETEN_BASE_URL = `https://model-${BASETEN_MODEL_ID}.api.baseten.co/environments/production/sync`;

if (!BASETEN_API_KEY) {
  console.error('BASETEN_API_KEY required');
  process.exit(1);
}

const proxy = http.createServer((req, res) => {
  console.log(`${req.method} ${req.url}`);

  const basePath = new URL(BASETEN_BASE_URL).pathname;
  const reqPath = (req.url || '/').replace(/^\//, '');
  const targetPath = reqPath ? `${basePath}/${reqPath}` : basePath;
  const targetUrl = new URL(targetPath, BASETEN_BASE_URL);

  const options = {
    hostname: targetUrl.hostname,
    port: 443,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: targetUrl.hostname,
      'authorization': `Api-Key ${BASETEN_API_KEY}`,
    },
  };

  delete options.headers['proxy-connection'];

  const proxyReq = https.request(options, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502);
    res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
  });

  req.pipe(proxyReq);
});

proxy.listen(PORT, () => {
  console.log(`Baseten proxy listening on http://127.0.0.1:${PORT}`);
  console.log(`Forwarding to ${BASETEN_BASE_URL}`);
  console.log(`Model: ${BASETEN_MODEL_ID}`);
});

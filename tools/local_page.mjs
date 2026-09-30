import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { page } from '../src/page.js';

const DEFAULT_WORKER_URL = 'https://buddy-remote-test.prenit-kathuria.workers.dev';
const DEFAULT_PORT = 4175;
const MAX_BODY_BYTES = 1024;

function makeWorkerUrl(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('BUDDY_WORKER_URL must be a bare HTTPS origin.');
  return url;
}

async function readSmallBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createLocalPageServer({ workerUrl = DEFAULT_WORKER_URL, fetchImpl = fetch, port = DEFAULT_PORT } = {}) {
  const worker = makeWorkerUrl(workerUrl);
  const allowedOrigins = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);

  return createServer(async (request, response) => {
    const url = new URL(request.url, `http://localhost:${port}`);
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'"
      }).end(page);
      return;
    }

    const allowed = (request.method === 'GET' && (url.pathname === '/api/status' || url.pathname === '/health')) ||
      (request.method === 'POST' && url.pathname === '/api/message');
    if (!allowed || url.search) {
      response.writeHead(404).end('Not found');
      return;
    }

    try {
      const headers = {};
      if (request.headers['x-admin-password'])
        headers['X-Admin-Password'] = request.headers['x-admin-password'];
      if (request.method === 'POST') headers['Content-Type'] = 'application/json';
      const body = request.method === 'POST' ? await readSmallBody(request) : undefined;
      const upstream = await fetchImpl(new URL(url.pathname, worker), {
        method: request.method,
        headers,
        body,
        redirect: 'error'
      });
      response.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      }).end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      const tooLarge = error.message === 'Request is too large.';
      response.writeHead(tooLarge ? 413 : 502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      }).end(JSON.stringify({ error: tooLarge ? error.message : 'Cannot reach the Cloudflare backend.' }));
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = DEFAULT_PORT;
  const workerUrl = process.env.BUDDY_WORKER_URL || DEFAULT_WORKER_URL;
  const server = createLocalPageServer({ workerUrl, port });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Buddy control page: http://localhost:${port}`);
    console.log(`Cloudflare backend: ${workerUrl}`);
  });
}

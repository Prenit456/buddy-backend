import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { page as remoteTestPage } from '../src/page.js';

const here = dirname(fileURLToPath(import.meta.url));
// In the ideathon workspace the app is a sibling; standalone GitHub clones
// carry a copy in site/ so the localhost preview also works there.
const workspaceAppRoot = resolve(here, '../../companion-app');
const appRoot = existsSync(workspaceAppRoot) ? workspaceAppRoot : resolve(here, '../site');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png' };

function workerOrigin(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('BUDDY_WORKER_URL must be a bare HTTPS origin.');
  return url.origin;
}

async function readBody(req) {
  const chunks = []; let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 8_000_000) throw Object.assign(new Error('Request is too large.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createCloudSite({ workerUrl = 'https://buddy-remote-test.prenit-kathuria.workers.dev',
  fetchImpl = fetch, port = 4176 } = {}) {
  const upstream = workerOrigin(workerUrl);
  return createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const origin = req.headers.origin;
    if (origin && origin !== `http://localhost:${port}` && origin !== `http://127.0.0.1:${port}`) {
      res.writeHead(403).end('Forbidden'); return;
    }
    if (url.pathname === '/remote-test' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': mime['.html'], 'Cache-Control': 'no-store' }).end(remoteTestPage); return;
    }
    if (url.pathname.startsWith('/api/')) {
      if (!url.pathname.startsWith('/api/v2/') && url.pathname !== '/health') {
        res.writeHead(404).end('Not found'); return;
      }
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        res.writeHead(405).end('Method not allowed'); return;
      }
      try {
        const headers = {};
        if (req.headers.authorization) headers.authorization = req.headers.authorization;
        if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
        const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : undefined;
        const target = upstream + url.pathname + url.search;
        const response = await fetchImpl(target, { method: req.method, headers, body, redirect: 'error',
          signal: AbortSignal.timeout(150_000) });
        res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        res.writeHead(error.status || 502, { 'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store' }).end(JSON.stringify({ error: error.status ? error.message : 'Cannot reach the Cloudflare backend.' }));
      }
      return;
    }
    if (req.method !== 'GET' || url.search && !['/settings', '/settings/'].includes(url.pathname)) {
      res.writeHead(404).end('Not found'); return;
    }
    const path = url.pathname === '/' ? '/portal.html' :
      ['/settings', '/settings/'].includes(url.pathname) ? '/index.html' : url.pathname;
    const file = resolve(appRoot, '.' + path);
    if (file !== appRoot && !file.startsWith(appRoot + sep)) { res.writeHead(403).end('Forbidden'); return; }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' }).end(data);
    } catch { res.writeHead(404).end('File not found'); }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 4176);
  const workerUrl = process.env.BUDDY_WORKER_URL || 'https://buddy-remote-test.prenit-kathuria.workers.dev';
  const server = createCloudSite({ workerUrl, port });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Buddy cloud website: http://localhost:${port}/`);
    console.log(`All care APIs:       ${workerUrl}`);
  });
}

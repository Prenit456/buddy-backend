import { page } from './page.js';

const headers = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer'
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function authorized(request, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const supplied = request.headers.get('Authorization') || '';
  const expected = `Bearer ${secret}`;
  if (supplied.length !== expected.length) return false;
  let different = 0;
  for (let i = 0; i < expected.length; i++)
    different |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return different === 0;
}

async function readState(db) {
  return db.prepare('SELECT revision, display_text, updated_at, ack_revision, ack_at FROM remote_state WHERE id = 1').first();
}

async function bodyJson(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 1024) throw new Error('Request is too large.');
  const raw = await request.text();
  if (raw.length > 1024) throw new Error('Request is too large.');
  try { return JSON.parse(raw); } catch { throw new Error('Send valid JSON.'); }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      return new Response(page, {
        headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'" }
      });
    }
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
    if (!url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
    if (!env.DB || !env.ADMIN_TOKEN || !env.DEVICE_TOKEN || env.ADMIN_TOKEN === env.DEVICE_TOKEN)
      return json({ error: 'Worker setup is incomplete. Add D1 and two different secret tokens.' }, 503);

    const deviceRoute = url.pathname.startsWith('/api/device/');
    if (!authorized(request, deviceRoute ? env.DEVICE_TOKEN : env.ADMIN_TOKEN))
      return json({ error: 'Invalid token.' }, 401);

    try {
      if (url.pathname === '/api/status' && request.method === 'GET') {
        const row = await readState(env.DB);
        if (!row) return json({ error: 'Apply the D1 migration first.' }, 503);
        return json({ revision: row.revision, displayText: row.display_text,
          updatedAt: row.updated_at, ackRevision: row.ack_revision, ackAt: row.ack_at });
      }
      if (url.pathname === '/api/message' && request.method === 'POST') {
        const body = await bodyJson(request);
        const value = typeof body.text === 'string' ? body.text.trim() : '';
        if (!value || value.length > 120 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value))
          return json({ error: 'Enter 1–120 readable characters.' }, 400);
        const now = new Date().toISOString();
        const result = await env.DB.prepare('UPDATE remote_state SET revision = revision + 1, display_text = ?, updated_at = ? WHERE id = 1')
          .bind(value, now).run();
        if (!result.meta?.changes) return json({ error: 'Apply the D1 migration first.' }, 503);
        const row = await readState(env.DB);
        return json({ revision: row.revision, displayText: row.display_text });
      }
      if (url.pathname === '/api/device/config' && request.method === 'GET') {
        const row = await readState(env.DB);
        if (!row) return json({ error: 'Apply the D1 migration first.' }, 503);
        return json({ revision: row.revision, displayText: row.display_text });
      }
      if (url.pathname === '/api/device/ack' && request.method === 'POST') {
        const body = await bodyJson(request);
        const revision = body.revision;
        if (!Number.isSafeInteger(revision) || revision < 0)
          return json({ error: 'Invalid revision.' }, 400);
        const row = await readState(env.DB);
        if (!row) return json({ error: 'Apply the D1 migration first.' }, 503);
        if (revision > row.revision) return json({ error: 'Unknown future revision.' }, 400);
        await env.DB.prepare('UPDATE remote_state SET ack_revision = ?, ack_at = ? WHERE id = 1 AND ack_revision < ?')
          .bind(revision, new Date().toISOString(), revision).run();
        return json({ ok: true });
      }
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      if (error.message === 'Request is too large.' || error.message === 'Send valid JSON.')
        return json({ error: error.message }, 400);
      console.error('Buddy remote test request failed', error);
      return json({ error: 'Storage error. Check the D1 binding and migration.' }, 503);
    }
  }
};

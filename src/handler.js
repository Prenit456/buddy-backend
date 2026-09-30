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

function equalCredentials(supplied, expected) {
  if (supplied.length !== expected.length) return false;
  let different = 0;
  for (let i = 0; i < expected.length; i++)
    different |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return different === 0;
}

function authorizedDevice(request, secret) {
  return typeof secret === 'string' && secret.length >= 32 &&
    equalCredentials(request.headers.get('Authorization') || '', `Bearer ${secret}`);
}

function authorizedAdmin(request, password) {
  return typeof password === 'string' && password.length > 0 &&
    equalCredentials(request.headers.get('X-Admin-Password') || '', password);
}

async function bodyJson(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 1024) throw new Error('Request is too large.');
  const raw = await request.text();
  if (raw.length > 1024) throw new Error('Request is too large.');
  try { return JSON.parse(raw); } catch { throw new Error('Send valid JSON.'); }
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/' && request.method === 'GET') {
    return new Response(page, {
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'" }
    });
  }
  if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
  if (!url.pathname.startsWith('/api/')) return json({ error: 'Not found.' }, 404);
  if (!env.REMOTE_STATE) return json({ error: 'Relay binding missing. Deploy with wrangler.jsonc.' }, 503);

  const deviceRoute = url.pathname.startsWith('/api/device/');
  if (deviceRoute) {
    if (!env.DEVICE_TOKEN) return json({ error: 'Add DEVICE_TOKEN Worker secret.' }, 503);
    if (!authorizedDevice(request, env.DEVICE_TOKEN)) return json({ error: 'Invalid device token.' }, 401);
  } else {
    if (!env.ADMIN_PASSWORD) return json({ error: 'Add ADMIN_PASSWORD Worker secret.' }, 503);
    if (!authorizedAdmin(request, env.ADMIN_PASSWORD)) return json({ error: 'Incorrect password.' }, 401);
  }

  try {
    const relay = env.REMOTE_STATE.getByName('buddy-remote-test');
    if (url.pathname === '/api/status' && request.method === 'GET')
      return json(await relay.readState());
    if (url.pathname === '/api/message' && request.method === 'POST') {
      const body = await bodyJson(request);
      const value = typeof body.text === 'string' ? body.text.trim() : '';
      if (!value || value.length > 120 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(value))
        return json({ error: 'Enter 1–120 readable characters.' }, 400);
      return json(await relay.sendMessage(value));
    }
    if (url.pathname === '/api/device/config' && request.method === 'GET') {
      const state = await relay.readState();
      return json({ revision: state.revision, displayText: state.displayText });
    }
    if (url.pathname === '/api/device/ack' && request.method === 'POST') {
      const body = await bodyJson(request);
      if (!Number.isSafeInteger(body.revision) || body.revision < 0)
        return json({ error: 'Invalid revision.' }, 400);
      const result = await relay.acknowledge(body.revision);
      return result.error ? json(result, 400) : json(result);
    }
    return json({ error: 'Not found.' }, 404);
  } catch (error) {
    if (error.message === 'Request is too large.' || error.message === 'Send valid JSON.')
      return json({ error: error.message }, 400);
    console.error('Buddy relay request failed', error);
    return json({ error: 'Relay unavailable. Check the Durable Object binding.' }, 503);
  }
}

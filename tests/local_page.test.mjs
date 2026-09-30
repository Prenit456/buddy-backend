import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalPageServer } from '../tools/local_page.mjs';

test('localhost page proxies only the control routes to the HTTPS Worker', async t => {
  const forwarded = [];
  const server = createLocalPageServer({
    workerUrl: 'https://buddy.example',
    port: 0,
    fetchImpl: async (url, options) => {
      forwarded.push({ url: String(url), options });
      return new Response(JSON.stringify({ revision: 1, displayText: 'Hello Buddy' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const page = await (await fetch(base)).text();
  assert.match(page, /Buddy remote-control test/);
  assert.match(page, /Enter your test password/);

  const response = await fetch(base + '/api/message', {
    method: 'POST',
    headers: { 'X-Admin-Password': 'test-password', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Hello Buddy' })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).displayText, 'Hello Buddy');
  assert.equal(forwarded.length, 1);
  assert.equal(forwarded[0].url, 'https://buddy.example/api/message');
  assert.equal(forwarded[0].options.headers['X-Admin-Password'], 'test-password');
  assert.equal(forwarded[0].options.redirect, 'error');

  assert.equal((await fetch(base + '/api/device/config')).status, 404);
  assert.equal((await fetch(base + '/api/status', { headers: { Origin: 'http://other.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/message', { method: 'POST', body: 'x'.repeat(1025) })).status, 413);
  assert.equal(forwarded.length, 1);
});

test('local page refuses non-HTTPS Worker origins', () => {
  assert.throws(() => createLocalPageServer({ workerUrl: 'http://buddy.example' }), /bare HTTPS origin/);
});

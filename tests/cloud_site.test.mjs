import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCloudSite } from '../tools/cloud_site.mjs';

test('cloud website serves the care app and proxies authenticated v2 API only', async () => {
  const upstreamRequests = [];
  const server = createCloudSite({ workerUrl: 'https://example.com', port: 0,
    fetchImpl: async (url, options) => {
      upstreamRequests.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(base + '/');
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Connect your ESP32/);
    const preview = await fetch(base + '/device-preview.js');
    assert.equal(preview.status, 200);
    assert.match(await preview.text(), /buddyTftPreview/);
    const api = await fetch(base + '/api/v2/me', {
      headers: { Authorization: 'Bearer synthetic-session' }
    });
    assert.equal(api.status, 200);
    assert.deepEqual(await api.json(), { ok: true });
    assert.equal(upstreamRequests[0].url, 'https://example.com/api/v2/me');
    assert.equal(upstreamRequests[0].options.headers.authorization, 'Bearer synthetic-session');
    assert.equal((await fetch(base + '/api/device/pairing')).status, 404);
  } finally {
    server.close();
    await once(server, 'close');
  }
});

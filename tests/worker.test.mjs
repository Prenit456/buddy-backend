import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/handler.js';

const ADMIN_PASSWORD = 'test-password';
const DEVICE_TOKEN = 'd'.repeat(64);

class FakeRelay {
  state = { revision: 0, displayText: '', updatedAt: null, ackRevision: 0, ackAt: null };
  async readState() { return { ...this.state }; }
  async sendMessage(text) {
    this.state.revision += 1;
    this.state.displayText = text;
    this.state.updatedAt = new Date().toISOString();
    return { revision: this.state.revision, displayText: text };
  }
  async acknowledge(revision) {
    if (revision > this.state.revision) return { error: 'Unknown future revision.' };
    if (revision > this.state.ackRevision) {
      this.state.ackRevision = revision;
      this.state.ackAt = new Date().toISOString();
    }
    return { ok: true };
  }
}

function env(relay = new FakeRelay()) {
  return {
    REMOTE_STATE: { getByName(name) {
      assert.equal(name, 'buddy-remote-test');
      return relay;
    } },
    ADMIN_PASSWORD,
    DEVICE_TOKEN
  };
}

function request(path, credential, body) {
  const deviceRoute = path.startsWith('/api/device/');
  return new Request('https://buddy-remote-test.example' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: credential ? deviceRoute
      ? { Authorization: 'Bearer ' + credential }
      : { 'X-Admin-Password': credential } : {},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function call(environment, path, credential, body) {
  const response = await handleRequest(request(path, credential, body), environment);
  return { status: response.status, body: await response.json() };
}

test('health is public but sending text requires the admin password', async () => {
  const bindings = env();
  assert.deepEqual((await call(bindings, '/health')).body, { ok: true });
  assert.equal((await call(bindings, '/api/status')).status, 401);
  assert.equal((await call(bindings, '/api/status', 'wrong')).status, 401);
  assert.equal((await call(bindings, '/api/status', DEVICE_TOKEN)).status, 401);
  assert.equal((await call(bindings, '/api/status', ADMIN_PASSWORD)).status, 200);
  const oldHeader = new Request('https://buddy-remote-test.example/api/status', {
    headers: { Authorization: 'Bearer ' + 'a'.repeat(64) }
  });
  assert.equal((await handleRequest(oldHeader, bindings)).status, 401);
});

test('device token is separate from the website password', async () => {
  const bindings = env();
  assert.equal((await call(bindings, '/api/device/config', ADMIN_PASSWORD)).status, 401);
  assert.equal((await call(bindings, '/api/device/config', DEVICE_TOKEN)).status, 200);
  assert.equal((await call({ ...bindings, DEVICE_TOKEN: 'short' }, '/api/device/config', 'short')).status, 401);
  assert.equal((await call({ ...bindings, DEVICE_TOKEN: undefined }, '/api/device/config')).status, 503);
});

test('laptop message reaches ESP polling route and acknowledgment reaches laptop', async () => {
  const bindings = env();
  assert.equal((await call(bindings, '/api/message', ADMIN_PASSWORD, { text: '   ' })).status, 400);
  assert.equal((await call(bindings, '/api/message', ADMIN_PASSWORD, { text: 'a'.repeat(121) })).status, 400);
  const saved = await call(bindings, '/api/message', ADMIN_PASSWORD, { text: 'Hello Buddy' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.deepEqual((await call(bindings, '/api/device/config', DEVICE_TOKEN)).body,
    { revision: 1, displayText: 'Hello Buddy' });
  assert.equal((await call(bindings, '/api/device/ack', DEVICE_TOKEN, { revision: 2 })).status, 400);
  assert.equal((await call(bindings, '/api/device/ack', DEVICE_TOKEN, { revision: 1 })).status, 200);
  const status = await call(bindings, '/api/status', ADMIN_PASSWORD);
  assert.equal(status.body.ackRevision, 1);
  assert.ok(status.body.ackAt);
});

test('missing relay binding reports deployment setup', async () => {
  const bindings = env();
  delete bindings.REMOTE_STATE;
  assert.equal((await call(bindings, '/api/status', ADMIN_PASSWORD)).status, 503);
  assert.equal((await call(bindings, '/api/device/config', DEVICE_TOKEN)).status, 503);
});

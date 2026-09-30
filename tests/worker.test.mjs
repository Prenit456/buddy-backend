import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/handler.js';

const DEVICE_TOKEN = 'd'.repeat(64);
const SESSION_TOKEN = 'a'.repeat(64);
const PAIR_CODE = '12345678';

class FakeRelay {
  state = { revision: 0, displayText: '', updatedAt: null, ackRevision: 0, ackAt: null };
  paired = false;
  async getPairingCode() { return { code: PAIR_CODE, expiresAt: Date.now() + 600000 }; }
  async pair(code) {
    if (this.paired) return { status: 400, error: 'Code expired.' };
    if (code !== PAIR_CODE) return { status: 401, error: 'That code does not match Buddy.' };
    this.paired = true;
    return { status: 200, token: SESSION_TOKEN, expiresAt: Date.now() + 86400000 };
  }
  async verifySession(token) { return this.paired && token === SESSION_TOKEN; }
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
    DEVICE_TOKEN
  };
}

function request(path, credential, body) {
  return new Request('https://buddy-remote-test.example' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: credential ? { Authorization: 'Bearer ' + credential } : {},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function call(environment, path, credential, body) {
  const response = await handleRequest(request(path, credential, body), environment);
  return { status: response.status, body: await response.json() };
}

test('health is public, while ESP pairing code requires its device credential', async () => {
  const bindings = env();
  assert.deepEqual((await call(bindings, '/health')).body, { ok: true });
  assert.equal((await call(bindings, '/api/device/pairing')).status, 401);
  assert.equal((await call(bindings, '/api/device/pairing', 'short')).status, 401);
  assert.equal((await call(bindings, '/api/device/pairing', DEVICE_TOKEN)).body.code, PAIR_CODE);
  assert.equal((await call({ ...bindings, DEVICE_TOKEN: undefined }, '/api/device/pairing')).status, 503);
});

test('a one-use code links the browser; old password header is not accepted', async () => {
  const bindings = env();
  assert.equal((await call(bindings, '/api/status')).status, 401);
  assert.equal((await call(bindings, '/api/pair', undefined, { code: 'bad' })).status, 400);
  assert.equal((await call(bindings, '/api/pair', undefined, { code: '00000000' })).status, 401);
  const linked = await call(bindings, '/api/pair', undefined, { code: PAIR_CODE });
  assert.equal(linked.status, 200);
  assert.equal(linked.body.token, SESSION_TOKEN);
  assert.equal((await call(bindings, '/api/pair', undefined, { code: PAIR_CODE })).status, 400);
  assert.equal((await call(bindings, '/api/status', SESSION_TOKEN)).status, 200);
  const oldHeader = new Request('https://buddy-remote-test.example/api/status', {
    headers: { 'X-Admin-Password': '1234' }
  });
  assert.equal((await handleRequest(oldHeader, bindings)).status, 401);
});

test('linked laptop message reaches ESP and acknowledgement returns to laptop', async () => {
  const bindings = env();
  await call(bindings, '/api/pair', undefined, { code: PAIR_CODE });
  assert.equal((await call(bindings, '/api/message', SESSION_TOKEN, { text: '   ' })).status, 400);
  assert.equal((await call(bindings, '/api/message', SESSION_TOKEN, { text: 'a'.repeat(121) })).status, 400);
  const saved = await call(bindings, '/api/message', SESSION_TOKEN, { text: 'Hello Buddy' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.deepEqual((await call(bindings, '/api/device/config', DEVICE_TOKEN)).body,
    { revision: 1, displayText: 'Hello Buddy' });
  assert.equal((await call(bindings, '/api/device/ack', DEVICE_TOKEN, { revision: 2 })).status, 400);
  assert.equal((await call(bindings, '/api/device/ack', DEVICE_TOKEN, { revision: 1 })).status, 200);
  const status = await call(bindings, '/api/status', SESSION_TOKEN);
  assert.equal(status.body.ackRevision, 1);
  assert.ok(status.body.ackAt);
});

test('missing relay binding reports deployment setup', async () => {
  const bindings = env();
  delete bindings.REMOTE_STATE;
  assert.equal((await call(bindings, '/api/status', SESSION_TOKEN)).status, 503);
  assert.equal((await call(bindings, '/api/device/config', DEVICE_TOKEN)).status, 503);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

const ADMIN_TOKEN = 'a'.repeat(64);
const DEVICE_TOKEN = 'd'.repeat(64);

class FakeD1 {
  constructor() {
    this.row = { revision: 0, display_text: '', updated_at: null,
      ack_revision: 0, ack_at: null };
  }
  prepare(sql) {
    const db = this;
    return {
      async first() { return db.row ? { ...db.row } : null; },
      bind(...args) {
        return { async run() {
          if (!db.row) return { meta: { changes: 0 } };
          if (sql.includes('revision = revision + 1')) {
            db.row.revision++;
            db.row.display_text = args[0];
            db.row.updated_at = args[1];
            return { meta: { changes: 1 } };
          }
          if (sql.includes('ack_revision = ?')) {
            if (db.row.ack_revision < args[2]) {
              db.row.ack_revision = args[0];
              db.row.ack_at = args[1];
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 0 } };
          }
          throw Error('Unexpected SQL');
        } };
      }
    };
  }
}

function request(path, token, body) {
  return new Request('https://buddy-remote-test.example' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: token ? { Authorization: 'Bearer ' + token } : {},
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function call(env, path, token, body) {
  const response = await worker.fetch(request(path, token, body), env);
  return { status: response.status, body: await response.json() };
}

test('requires separate, private admin and device tokens', async () => {
  const env = { DB: new FakeD1(), ADMIN_TOKEN, DEVICE_TOKEN };
  assert.equal((await call(env, '/api/status')).status, 401);
  assert.equal((await call(env, '/api/status', DEVICE_TOKEN)).status, 401);
  assert.equal((await call(env, '/api/device/config', ADMIN_TOKEN)).status, 401);
  assert.equal((await call(env, '/api/status', ADMIN_TOKEN)).status, 200);
  assert.equal((await call({ ...env, DEVICE_TOKEN: ADMIN_TOKEN }, '/api/status', ADMIN_TOKEN)).status, 503);
});

test('website changes are versioned and device acknowledgment is visible', async () => {
  const env = { DB: new FakeD1(), ADMIN_TOKEN, DEVICE_TOKEN };
  assert.equal((await call(env, '/api/message', ADMIN_TOKEN, { text: '   ' })).status, 400);
  assert.equal((await call(env, '/api/message', ADMIN_TOKEN, { text: 'a'.repeat(121) })).status, 400);
  const saved = await call(env, '/api/message', ADMIN_TOKEN, { text: 'Hello Buddy' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.deepEqual((await call(env, '/api/device/config', DEVICE_TOKEN)).body,
    { revision: 1, displayText: 'Hello Buddy' });
  assert.equal((await call(env, '/api/device/ack', DEVICE_TOKEN, { revision: 2 })).status, 400);
  assert.equal((await call(env, '/api/device/ack', DEVICE_TOKEN, { revision: 1 })).status, 200);
  const status = await call(env, '/api/status', ADMIN_TOKEN);
  assert.equal(status.body.ackRevision, 1);
  assert.ok(status.body.ackAt);
});

test('missing D1 migration reports setup instead of silently losing changes', async () => {
  const db = new FakeD1();
  db.row = null;
  const env = { DB: db, ADMIN_TOKEN, DEVICE_TOKEN };
  assert.equal((await call(env, '/api/status', ADMIN_TOKEN)).status, 503);
  assert.equal((await call(env, '/api/message', ADMIN_TOKEN, { text: 'Hello' })).status, 503);
});

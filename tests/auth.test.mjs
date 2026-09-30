import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CareHub } from '../src/care-hub.mjs';

function fixture() {
  let saved = null;
  const stateStore = {
    async load() { return saved === null ? null : structuredClone(saved); },
    async save(value) { saved = structuredClone(value); }
  };
  const defaults = { person: {}, reminders: [], contacts: [], safety: {}, device: { timezone: 'Asia/Kolkata' } };
  const makeHub = () => new CareHub({ directory: '/unused', defaults, stateStore, services: { cloud: true } });
  return { makeHub };
}

async function call(hub, path, body) {
  let status, value;
  await hub.handle({ method: 'POST', headers: {}, socket: { remoteAddress: 'test' } }, {},
    new URL('https://buddy.example' + path), {
      json(_res, code, data) { status = code; value = data; },
      bodyJson: async () => body
    });
  return { status, value };
}

test('username-only user and carer accounts persist and log in without email', async () => {
  const { makeHub } = fixture();
  const hub = await makeHub().init();
  const owner = await call(hub, '/api/v2/auth/register', {
    username: 'Prenit', password: 'demo-password-123', role: 'user'
  });
  assert.equal(owner.status, 201);
  assert.equal(owner.value.user.name, 'Prenit');
  assert.equal(owner.value.user.username, 'prenit');
  assert.equal(owner.value.user.email, undefined);
  assert.equal(hub.db.circles.length, 1);
  assert.notEqual(hub.db.users[0].passwordHash, 'demo-password-123');

  const carer = await call(hub, '/api/v2/auth/register', {
    username: 'Family_Member', password: 'another-demo-password', role: 'supervisor'
  });
  assert.equal(carer.status, 201);
  assert.equal(carer.value.user.role, 'supervisor');
  assert.equal(hub.db.circles.length, 1);

  const reloaded = await makeHub().init();
  const login = await call(reloaded, '/api/v2/auth/login', {
    username: 'PRENIT', password: 'demo-password-123'
  });
  assert.equal(login.status, 200);
  assert.equal(login.value.user.id, owner.value.user.id);
  assert.equal((await call(reloaded, '/api/v2/auth/login', {
    username: 'Family_Member', password: 'another-demo-password'
  })).status, 200);
  assert.equal((await call(reloaded, '/api/v2/auth/login', {
    username: 'prenit', password: 'wrong-password'
  })).status, 401);
  assert.equal((await call(reloaded, '/api/v2/auth/register', {
    username: 'PRENIT', password: 'another-demo-password', role: 'user'
  })).status, 409);
  assert.equal(reloaded.db.users.length, 2);
  hub.close(); reloaded.close();
});

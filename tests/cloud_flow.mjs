// Optional end-to-end check against `wrangler dev --local` only. Never point
// this at production: it creates fictional accounts and a pairing in local D1.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const base = process.env.BUDDY_TEST_WORKER || 'http://127.0.0.1:8790';
const target = new URL(base);
if (target.hostname !== 'localhost' && target.hostname !== '127.0.0.1')
  throw new Error('cloud_flow.mjs may run only against localhost.');
const deviceToken = process.env.BUDDY_TEST_DEVICE_TOKEN;
if (!deviceToken || deviceToken.length < 32) throw new Error('Set a synthetic BUDDY_TEST_DEVICE_TOKEN.');

async function api(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, value: await response.json() };
}

const suffix = randomUUID().replaceAll('-', '').slice(0, 24);
const owner = await api('/api/v2/auth/register', { method: 'POST', body: {
  role: 'user', username: `owner-${suffix}`, password: 'fictional-passphrase-123' } });
assert.equal(owner.status, 201, JSON.stringify(owner.value));
const ownerToken = owner.value.token;
const ownerLogin = await api('/api/v2/auth/login', { method: 'POST', body: {
  username: `owner-${suffix}`, password: 'fictional-passphrase-123' } });
assert.equal(ownerLogin.status, 200, JSON.stringify(ownerLogin.value));
const me = await api('/api/v2/me', { token: ownerToken });
assert.equal(me.status, 200);
const circle = me.value.circles[0].id;

const pairing = await api('/api/device/pairing', { token: deviceToken });
assert.equal(pairing.status, 200);
assert.match(pairing.value.code, /^\d{8}$/);
const claimed = await api(`/api/v2/circles/${circle}/devices/claim`, {
  method: 'POST', token: ownerToken, body: { code: pairing.value.code } });
assert.equal(claimed.status, 200, JSON.stringify(claimed.value));
const deviceId = claimed.value.device.id;
assert.equal((await api('/api/device/pairing', { token: deviceToken })).value.paired, true);
const firstSync = await api('/api/device/sync', { method: 'POST', token: deviceToken,
  body: { appliedRevision: 0, capabilities: { camera: true, audio: true },
    status: { mode: 'ready', headline: 'Buddy online' }, ack: [], events: [] } });
assert.equal(firstSync.status, 200, JSON.stringify(firstSync.value));
assert.equal(firstSync.value.paired, true);
assert.ok(firstSync.value.settings);
const settings = firstSync.value.settings;
settings.display.eyeColor = 32724;
settings.voice.voiceId = 'brian';
settings._revision = firstSync.value.revision;
const saved = await api(`/api/v2/circles/${circle}/bridge/api/settings`, {
  method: 'PUT', token: ownerToken, body: settings });
assert.equal(saved.status, 200, JSON.stringify(saved.value));
const settingsSync = await api('/api/device/sync', { method: 'POST', token: deviceToken,
  body: { appliedRevision: firstSync.value.revision, capabilities: { camera: true, audio: true },
    status: { mode: 'ready' }, ack: [], events: [] } });
assert.equal(settingsSync.value.settings.display.eyeColor, 32724);
assert.equal(settingsSync.value.settings.voice.voiceId, 'brian');

const supervisor = await api('/api/v2/auth/register', { method: 'POST', body: {
  role: 'supervisor', username: `supervisor-${suffix}`,
  password: 'fictional-passphrase-123' } });
assert.equal(supervisor.status, 201);
const invite = await api(`/api/v2/circles/${circle}/invite`, {
  method: 'POST', token: ownerToken, body: { canEdit: true, canCamera: true } });
assert.equal(invite.status, 200);
const joined = await api('/api/v2/join', { method: 'POST', token: supervisor.value.token,
  body: { code: invite.value.code } });
assert.equal(joined.status, 200, JSON.stringify(joined.value));
const message = await api(`/api/v2/circles/${circle}/messages`, {
  method: 'POST', token: supervisor.value.token, body: { message: 'Hello from your care circle' } });
assert.equal(message.status, 200);
const afterMessage = await api('/api/device/sync', { method: 'POST', token: deviceToken,
  body: { appliedRevision: saved.value._revision, capabilities: { camera: true, audio: true },
    status: { mode: 'ready' }, ack: [], events: [] } });
assert.ok(afterMessage.value.commands.some(command => command.type === 'say'));

const sos = await api(`/api/v2/circles/${circle}/bridge/api/actions`, {
  method: 'POST', token: ownerToken, body: { action: 'sos' } });
assert.equal(sos.status, 200);
const afterSos = await api(`/api/v2/circles/${circle}`, { token: ownerToken });
assert.ok(afterSos.value.alerts.some(alert => alert.kind === 'sos' && !alert.resolvedAt));

const call = await api(`/api/v2/circles/${circle}/calls`, { method: 'POST',
  token: supervisor.value.token, body: { to: deviceId, kind: 'video' } });
assert.equal(call.status, 201, JSON.stringify(call.value));
const ringing = await api('/api/device/sync', { method: 'POST', token: deviceToken,
  body: { appliedRevision: saved.value._revision, capabilities: { camera: true, audio: true },
    status: { mode: 'ready' }, ack: [], events: [] } });
assert.ok(ringing.value.commands.some(command => command.type === 'call_ring'));
const accepted = await api('/api/device/sync', { method: 'POST', token: deviceToken,
  body: { appliedRevision: saved.value._revision, capabilities: { camera: true, audio: true },
    status: { mode: 'call' }, ack: ringing.value.commands.map(command => command.id),
    events: [{ eventId: randomUUID(), type: 'call_control', reminderId: 'accept', createdAt: Date.now() }] } });
assert.equal(accepted.status, 200);
assert.ok(accepted.value.commands.some(command => command.type === 'call_start'));
const current = await api(`/api/v2/calls/${call.value.call.id}`, { token: supervisor.value.token });
assert.equal(current.value.call.status, 'accepted');
console.log('Cloud accounts, D1 settings, pairing, messages, SOS alert, and call signaling passed.');

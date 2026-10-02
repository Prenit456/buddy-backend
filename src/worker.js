import { DurableObject } from 'cloudflare:workers';
import { handleRequest } from './handler.js';
export { CareState } from './care-state.mjs';

const initialState = () => ({
  revision: 0,
  displayText: '',
  updatedAt: null,
  ackRevision: 0,
  ackAt: null
});

const PAIR_CODE_LIFETIME_MS = 10 * 60 * 1000;
const SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const PAIR_LOCK_MS = 60 * 1000;

function randomHex(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomPairCode() {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 100000000;
  return String(value).padStart(8, '0');
}

async function tokenHash(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

// One named object holds the latest test message. Cloudflare provisions its
// storage with the Worker; there is no D1 binding or SQL migration to run.
export class RemoteState extends DurableObject {
  async getPairingCode() {
    const linked = await this.ctx.storage.get('linked');
    if (linked) return { paired: true, code: '', expiresAt: 0 };
    const now = Date.now();
    let pairing = await this.ctx.storage.get('pairing');
    const canRotate = !pairing?.lockedUntil || pairing.lockedUntil <= now;
    if (!pairing || (canRotate && (pairing.used || pairing.expiresAt <= now || pairing.attempts >= 5))) {
      pairing = { code: randomPairCode(), expiresAt: now + PAIR_CODE_LIFETIME_MS,
        attempts: 0, lockedUntil: 0, used: false };
      await this.ctx.storage.put('pairing', pairing);
    }
    return { paired:false, code: pairing.code, expiresAt: pairing.expiresAt };
  }

  async pair(code) {
    if (await this.ctx.storage.get('linked'))
      return { status: 409, error: 'Buddy is already paired. Unpair it on the device first.' };
    const now = Date.now();
    const pairing = await this.ctx.storage.get('pairing');
    if (!pairing || pairing.used || pairing.expiresAt <= now)
      return { status: 400, error: 'Code expired. Read the current code on Buddy.' };
    if (pairing.lockedUntil > now)
      return { status: 429, error: 'Too many tries. Wait one minute for a new code.' };
    if (pairing.code !== code) {
      pairing.attempts += 1;
      if (pairing.attempts >= 5) pairing.lockedUntil = now + PAIR_LOCK_MS;
      await this.ctx.storage.put('pairing', pairing);
      return { status: 401, error: pairing.lockedUntil > now
        ? 'Too many tries. Wait one minute for a new code.' : 'That code does not match Buddy.' };
    }

    const token = randomHex(32);
    const expiresAt = now + SESSION_LIFETIME_MS;
    await this.ctx.storage.put('session', { hash: await tokenHash(token), expiresAt });
    pairing.used = true;
    await this.ctx.storage.put('pairing', pairing);
    return { status: 200, token, expiresAt };
  }

  async verifySession(token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
    const session = await this.ctx.storage.get('session');
    return !!session && session.expiresAt > Date.now() && session.hash === await tokenHash(token);
  }

  async linkCircle(circleId, deviceId) {
    await this.ctx.storage.put('linked', { circleId, deviceId });
    await this.ctx.storage.delete('session');
  }

  async unlinkCircle() {
    await this.ctx.storage.delete('linked');
    await this.ctx.storage.delete('pairing');
    await this.ctx.storage.delete('session');
  }

  async linkedCircle() { return (await this.ctx.storage.get('linked')) || null; }

  async readState() {
    return (await this.ctx.storage.get('state')) || initialState();
  }

  async sendMessage(text) {
    const state = await this.readState();
    state.revision += 1;
    state.displayText = text;
    state.updatedAt = new Date().toISOString();
    await this.ctx.storage.put('state', state);
    return { revision: state.revision, displayText: state.displayText };
  }

  async acknowledge(revision) {
    const state = await this.readState();
    if (revision > state.revision) return { error: 'Unknown future revision.' };
    if (revision > state.ackRevision) {
      state.ackRevision = revision;
      state.ackAt = new Date().toISOString();
      await this.ctx.storage.put('state', state);
    }
    return { ok: true };
  }
}

export default { fetch: handleRequest };

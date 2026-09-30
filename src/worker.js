import { DurableObject } from 'cloudflare:workers';
import { handleRequest } from './handler.js';

const initialState = () => ({
  revision: 0,
  displayText: '',
  updatedAt: null,
  ackRevision: 0,
  ackAt: null
});

// One named object holds the latest test message. Cloudflare provisions its
// storage with the Worker; there is no D1 binding or SQL migration to run.
export class RemoteState extends DurableObject {
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

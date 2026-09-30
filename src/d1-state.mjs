// One CareState Durable Object serializes mutations; D1 persists the complete
// care-circle document between isolates. This is a prototype, not a scalable
// substitute for normalized tables or a backup policy.
export class D1State {
  constructor(db) { this.db = db; }
  async load() {
    const row = await this.db.prepare('SELECT payload FROM buddy_state WHERE id = 1').first();
    return row ? JSON.parse(row.payload) : null;
  }
  async save(data) {
    const payload = JSON.stringify(data);
    if (payload.length > 1_000_000) throw new Error('Buddy data limit reached; export older history before continuing.');
    await this.db.prepare('INSERT INTO buddy_state (id, payload, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP').bind(payload).run();
  }
}

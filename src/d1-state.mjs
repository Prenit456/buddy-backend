// One CareState Durable Object serializes mutations; D1 persists the complete
// care-circle document between isolates. This is a prototype, not a scalable
// substitute for normalized tables or a backup policy.
export class D1State {
  constructor(db) { this.db = db; }
  async load() {
    // A fresh prototype database may be bound before its migration is run.
    // This is idempotent, and leaves existing care data untouched.
    await this.db.prepare(`CREATE TABLE IF NOT EXISTS buddy_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).run();
    const row = await this.db.prepare('SELECT payload FROM buddy_state WHERE id = 1').first();
    return row ? JSON.parse(row.payload) : null;
  }
  async save(data) {
    const payload = JSON.stringify(data);
    if (payload.length > 1_000_000) throw new Error('Buddy data limit reached; export older history before continuing.');
    await this.db.prepare('INSERT INTO buddy_state (id, payload, updated_at) VALUES (1, ?, CURRENT_TIMESTAMP) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP').bind(payload).run();
  }
}

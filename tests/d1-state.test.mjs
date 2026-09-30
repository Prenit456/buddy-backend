import { test } from 'node:test';
import assert from 'node:assert/strict';
import { D1State } from '../src/d1-state.mjs';

test('fresh D1 binding creates only the missing care table before loading', async () => {
  const statements = [];
  let payload = null;
  const db = { prepare(sql) {
    statements.push(sql);
    const statement = {
      run: async () => { if (sql.startsWith('INSERT')) payload = statement.bound[0]; },
      first: async () => payload === null ? null : { payload },
      bind(...values) { statement.bound = values; return statement; }
    };
    return statement;
  } };
  const state = new D1State(db);
  assert.equal(await state.load(), null);
  assert.match(statements[0], /CREATE TABLE IF NOT EXISTS buddy_state/);
  assert.match(statements[1], /SELECT payload FROM buddy_state/);
  await state.save({ users: [{ username: 'prenit carer' }] });
  assert.deepEqual(await state.load(), { users: [{ username: 'prenit carer' }] });
  assert.equal(statements.filter(sql => sql.startsWith('CREATE TABLE')).length, 2);
});

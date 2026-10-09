import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';

const callerId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';
const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/global-user-admin/index.ts', import.meta.url), 'utf8').replace(/^import.*\n/, ''));

function harness({ active = true, authenticated = true, admin = true, allowed = true, unbanFails = false } = {}) {
  const calls = [];
  let handler;
  const db = {
    auth: {
      getUser: async () => ({ data: { user: authenticated ? { id: callerId } : null }, error: null }),
      admin: {
        updateUserById: async (id, attributes) => {
          calls.push(['unban', id, attributes]);
          return { error: unbanFails ? new Error('Auth unavailable') : null };
        },
        generateLink: async () => {
          calls.push(['link']);
          return { data: { properties: { hashed_token: 'test-only-token' } }, error: null };
        },
      },
    },
    from(table) {
      const filters = {};
      let update;
      const query = {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        update(value) { update = value; return this; },
        maybeSingle() { return Promise.resolve(result()); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      function result() {
        const caller = filters.uid === callerId || filters.user_id === callerId;
        if (update) { calls.push(['profile', update]); return { error: null }; }
        if (table === 'operadores') return { data: caller ? { activo: true } : { id: 2, uid: targetId, email: 'target@example.test', activo: active } };
        if (table === 'global_system_admins') return { data: caller && admin ? { user_id: callerId } : null };
        return { data: [{ department: caller ? 'shipping' : allowed ? 'shipping' : 'production', role: caller ? 'supervisor' : 'operador', active: true }] };
      }
      return query;
    },
  };
  new Function('createClient', 'Deno', source)(() => db, { env: { get: () => 'test-only' }, serve: value => { handler = value; } });
  return {
    calls,
    async request(action = 'link') {
      const res = await handler(new Request('https://example.test', { method: 'POST', headers: { authorization: 'Bearer test', 'content-type': 'application/json' }, body: JSON.stringify({ action, user_id: targetId }) }));
      return { status: res.status, body: await res.json() };
    },
  };
}

test('active account clears a stale ban before creating its password link', async () => {
  const app = harness();
  const res = await app.request();
  assert.equal(res.status, 200);
  assert.match(res.body.link, /set-password#token_hash=/);
  assert.deepEqual(app.calls.map(c => c[0]), ['unban', 'link']);
  assert.deepEqual(app.calls[0], ['unban', targetId, { ban_duration: 'none' }]);
});
test('inactive account cannot be unbanned through password links', async () => {
  const app = harness({ active: false });
  assert.equal((await app.request()).status, 400);
  assert.deepEqual(app.calls, []);
});
test('unauthenticated caller cannot change authentication state', async () => {
  const app = harness({ authenticated: false });
  assert.equal((await app.request()).status, 401);
  assert.deepEqual(app.calls, []);
});
test('supervisor cannot unban a user outside their departments', async () => {
  const app = harness({ admin: false, allowed: false });
  assert.equal((await app.request()).status, 403);
  assert.deepEqual(app.calls, []);
});
test('an Auth failure prevents generation of an unusable link', async () => {
  const app = harness({ unbanFails: true });
  assert.equal((await app.request()).status, 500);
  assert.deepEqual(app.calls.map(c => c[0]), ['unban']);
});
test('reactivation clears Auth ban before marking the profile active', async () => {
  const app = harness({ active: false });
  assert.equal((await app.request('reactivate')).status, 200);
  assert.deepEqual(app.calls.map(c => c[0]), ['unban', 'profile']);
  assert.deepEqual(app.calls[1][1], { activo: true, inactive_since: null });
});
test('failed Auth reactivation leaves the profile inactive', async () => {
  const app = harness({ active: false, unbanFails: true });
  assert.equal((await app.request('reactivate')).status, 500);
  assert.deepEqual(app.calls.map(c => c[0]), ['unban']);
});
test('department supervisors cannot reactivate global accounts', async () => {
  const app = harness({ active: false, admin: false });
  assert.equal((await app.request('reactivate')).status, 403);
  assert.deepEqual(app.calls, []);
});

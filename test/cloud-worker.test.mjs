// The Worker's backup copy routes: it stores only what the phone sends (already scrambled), keeps the previous copy, caps size and number.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../relay/push-worker.js';

const kv = () => { const m = new Map(); return { m, get: async (k, t) => { const v = m.get(k); return v === undefined ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; };
const call = (env, path, body, origin = 'https://ayman-sketch97.github.io') =>
  worker.fetch(new Request('https://w.test' + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env).then(async (r) => ({ status: r.status, body: await r.json() }));
const id = (c) => c.repeat(64);
const data = (ct) => ({ v: 1, iv: 'aXY=', ct });

test('put then get returns the same scrambled text; the previous copy is kept', async () => {
  const env = { PUSH: kv() };
  assert.equal((await call(env, '/sync/put', { id: id('a'), data: data('one') })).status, 200);
  assert.equal((await call(env, '/sync/put', { id: id('a'), data: data('two') })).status, 200);
  assert.equal((await call(env, '/sync/get', { id: id('a') })).body.data.ct, 'two');
  assert.equal(JSON.parse(env.PUSH.m.get('syncprev:' + id('a'))).ct, 'one');
});

test('unknown id, bad id and wrong site are refused', async () => {
  const env = { PUSH: kv() };
  assert.equal((await call(env, '/sync/get', { id: id('b') })).status, 404);
  assert.equal((await call(env, '/sync/get', { id: 'short' })).status, 400);
  assert.equal((await call(env, '/sync/put', { id: id('a'), data: data('x') }, 'https://evil.example')).status, 403);
  assert.equal((await call(env, '/sync/put', { id: id('a'), data: { ct: 5 } })).status, 400);
});

test('size and number of backups are capped', async () => {
  const env = { PUSH: kv() };
  assert.equal((await call(env, '/sync/put', { id: id('a'), data: data('x'.repeat(2100000)) })).status, 400);
  for (const c of 'abcde') assert.equal((await call(env, '/sync/put', { id: id(c), data: data('x') })).status, 200);
  assert.equal((await call(env, '/sync/put', { id: id('f'), data: data('x') })).status, 409);
  assert.equal((await call(env, '/sync/put', { id: id('a'), data: data('y') })).status, 200); // an existing one can still be updated
});

test('delete removes the copy and frees its place', async () => {
  const env = { PUSH: kv() };
  await call(env, '/sync/put', { id: id('a'), data: data('x') });
  await call(env, '/sync/delete', { id: id('a') });
  assert.equal((await call(env, '/sync/get', { id: id('a') })).status, 404);
  assert.deepEqual(JSON.parse(env.PUSH.m.get('syncids')), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Firestore, StoreError, encodeFields, decodeFields, encodeValue, decodeValue } from './firestore.js';

const env = { FIREBASE_PROJECT_ID: 'subway-runner-513217' };

test('Firestore field encoding preserves nested profiles and rejects imprecise currency numbers', () => {
  const value = { coins: 1200, diamonds: 20, odds: 0.35, enabled: true, absent: null, name: 'Kai', empty: [], inventory: { magnet: 2 }, rewards: [{ id: 'shield', amount: 1 }] };
  assert.deepEqual(decodeFields(encodeFields(value)), value);
  assert.deepEqual(decodeFields(encodeFields({ value: 1, omitted: undefined })), { value: 1 });
  assert.deepEqual(decodeValue({ mapValue: {} }), {});
  assert.deepEqual(decodeValue({ arrayValue: {} }), []);
  assert.equal(decodeValue({ timestampValue: '2026-10-30T00:00:00Z' }), '2026-10-30T00:00:00Z');
  for (const number of [NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => encodeValue(number), { code: 'invalid_number' });
  assert.throws(() => decodeValue({ integerValue: '9223372036854775807' }), { code: 'invalid_stored_number' });
  const store = new Firestore(env, () => { throw new Error('No network is allowed in this test.'); });
  for (const path of ['players/a?x=y', 'players/../a', '/players/a', 'players//a', 'players/a/']) assert.throws(() => store.path(path), { code: 'invalid_document_path' });
});

test('ABORTED retries the complete transaction and commits profile plus global marker atomically', async () => {
  class FakeTransactionalFirestore extends Firestore {
    constructor() { super(env); this.coins = 10; this.begun = 0; this.commits = []; this.rollbacks = []; this.reads = 0; this.marker = null; }
    async request(path, method, body) {
      if (path === ':beginTransaction') return { transaction: 'tx-' + (++this.begun) };
      if (path === ':rollback') { this.rollbacks.push(body.transaction); return {}; }
      if (method === 'GET') {
        this.reads++;
        if (path.startsWith('/players/owner?')) return { fields: encodeFields({ coins: this.coins }) };
        if (path.startsWith('/purchaseMarkers/token?')) return this.marker ? { fields: encodeFields(this.marker) } : null;
      }
      if (path === ':commit') {
        this.commits.push(structuredClone(body));
        assert.equal(body.writes.length, 2);
        if (this.commits.length === 1) {
          // A separate winner committed before this snapshot. No write from
          // the losing transaction is applied to either document.
          this.coins = 20;
          assert.equal(this.marker, null);
          throw new StoreError('transaction_conflict', 409);
        }
        const documents = new Map(body.writes.map(write => [write.update.name.slice(this.prefix.length + 1), decodeFields(write.update.fields)]));
        this.coins = documents.get('players/owner').coins;
        this.marker = documents.get('purchaseMarkers/token');
        return {};
      }
      assert.fail(`Unexpected fake Firestore request: ${method} ${path}`);
    }
  }
  const store = new FakeTransactionalFirestore();
  let actions = 0;
  const result = await store.transaction(async tx => {
    actions++;
    const profile = await tx.get('players/owner');
    assert.equal((await tx.get('players/owner')).coins, profile.coins); // cached snapshot
    assert.equal(await tx.get('purchaseMarkers/token'), null);
    profile.coins += 5;
    tx.set('players/owner', profile);
    tx.set('purchaseMarkers/token', { granted: true });
    return profile.coins;
  });
  assert.equal(result, 25);
  assert.equal(store.coins, 25);
  assert.deepEqual(store.marker, { granted: true });
  assert.equal(actions, 2);
  assert.equal(store.reads, 4);
  assert.deepEqual(store.rollbacks, ['tx-1']);
  assert.equal(store.commits[1].transaction, 'tx-2');
});

test('recursive deletion follows all collection-ID and document pages before deleting parents', async () => {
  class FakeDeletionFirestore extends Firestore {
    constructor() { super(env); this.calls = []; this.deleted = []; }
    document(path) { return { name: this.prefix + '/' + path }; }
    async request(path, method = 'GET', body, allow404) {
      this.calls.push({ path, method, body });
      if (method === 'DELETE') { assert.equal(allow404, true); this.deleted.push(path); return null; }
      if (path.endsWith(':listCollectionIds')) {
        if (path === '/players/owner:listCollectionIds') {
          if (!body.pageToken) return { collectionIds: ['runs'], nextPageToken: 'next-collections' };
          assert.equal(body.pageToken, 'next-collections');
          return { collectionIds: ['operations'] };
        }
        if (path === '/players/owner/runs/first:listCollectionIds') return { collectionIds: ['children'] };
        return {};
      }
      if (path === '/players/owner/runs?pageSize=100') return { documents: [this.document('players/owner/runs/first')], nextPageToken: 'page+two/=' };
      if (path === '/players/owner/runs?pageSize=100&pageToken=page%2Btwo%2F%3D') return { documents: [this.document('players/owner/runs/second')] };
      if (path === '/players/owner/operations?pageSize=100') return { documents: [this.document('players/owner/operations/op')] };
      if (path === '/players/owner/runs/first/children?pageSize=100') return { documents: [this.document('players/owner/runs/first/children/child')] };
      assert.fail(`Unexpected fake Firestore request: ${method} ${path}`);
    }
  }
  const store = new FakeDeletionFirestore();
  await store.deleteTree('players/owner');
  assert.deepEqual(store.deleted, ['/players/owner/runs/first/children/child', '/players/owner/runs/first', '/players/owner/runs/second', '/players/owner/operations/op', '/players/owner']);
  assert.deepEqual(store.calls.slice(0, 2).map(call => call.path), ['/players/owner:listCollectionIds', '/players/owner:listCollectionIds']);
});

test('REST transport bounds requests and sanitizes local fake network, JSON and ABORTED failures', async () => {
  // Explicit local service-account fixture. The fake accepts only the OAuth
  // URL and this project's Firestore URL; it never falls back to real fetch.
  const rsa = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', rsa.privateKey);
  const fixture = { ...env, GOOGLE_SERVICE_ACCOUNT_EMAIL: 'local-fixture@test-fixture.iam.gserviceaccount.com', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----` };
  let mode = 'network';
  const fakeGoogle = async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'local-datastore-only', token_type: 'Bearer', expires_in: 3600 });
    assert.equal(url, `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/players/owner`);
    assert.equal(init.headers.Authorization, 'Bearer local-datastore-only');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    if (mode === 'network') throw new Error('sensitive underlying network detail');
    if (mode === 'json') return new Response('not-json');
    if (mode === 'aborted') return Response.json({ error: { status: 'ABORTED', message: 'sensitive Google detail' } }, { status: 409 });
    return new Response('', { status: 404 });
  };
  const store = new Firestore(fixture, fakeGoogle);
  for (mode of ['network', 'json']) await assert.rejects(store.get('players/owner'), error => error.code === 'firestore_unavailable' && error.status === 503 && error.message === 'firestore_unavailable');
  mode = 'aborted';
  await assert.rejects(store.get('players/owner'), { code: 'transaction_conflict', status: 409 });
  mode = 'missing';
  assert.equal(await store.get('players/owner'), null);
});

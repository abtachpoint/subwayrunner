import test from 'node:test';
import assert from 'node:assert/strict';
import { Economy, AD_UNITS, sha256 } from './economy.js';
import { handleRequest } from './index.js';

// This serialized adapter exists only in the offline tests. Worker production
// uses Firestore transactions; it cannot select this adapter via configuration.
class MemoryStore {
  data = new Map(); tail = Promise.resolve();
  async get(path) { await this.tail; return structuredClone(this.data.get(path) ?? null); }
  async transaction(callback) {
    const run = this.tail.then(async () => {
      const staged = new Map(Array.from(this.data, ([k, v]) => [k, structuredClone(v)]));
      const result = await callback({ get: async path => structuredClone(staged.get(path) ?? null), set: (path, value) => staged.set(path, structuredClone(value)), delete: path => staged.delete(path) });
      this.data = staged; return result;
    });
    this.tail = run.catch(() => {}); return run;
  }
  async query(collection, field, value, limit = 100) { await this.tail; return [...this.data].filter(([p, v]) => p.startsWith(collection + '/') && p.split('/').length === 2 && v[field] === value).slice(0, limit).map(([path, value]) => ({ path, value: structuredClone(value) })); }
  async deleteTree(path) { return this.transaction(async tx => { for (const key of [...this.data.keys()]) if (key === path || key.startsWith(path + '/')) tx.delete(key); }); }
}
const UID = 'local-test-user/with-punctuation';
const id = () => crypto.randomUUID();
async function setup() {
  let now = Date.parse('2026-10-30T12:00:00Z');
  const store = new MemoryStore(), owner = await sha256(UID);
  const env = { FIREBASE_PROJECT_ID: 'subway-runner-513217', PLAY_PACKAGE_NAME: 'com.subwayrunner.bd', LEDGER_ENCRYPTION_KEY: Buffer.alloc(32, 19).toString('base64') };
  const purchases = new Map(), voided = [], voidCalls = []; let failConsume = false, failDelete = false, consumed = 0, deleted = 0, voidHandler = null;
  const fakeGoogle = {
    async verifyPurchase(productId, token) { return { state: 'PURCHASED', productId, quantity: 1, obfuscatedAccountId: owner, consumed: false, ...purchases.get(token) }; },
    async consumePurchase() { consumed++; if (failConsume) throw new Error('explicit offline consume fixture'); },
    async listVoidedPurchases(start, token, end) { voidCalls.push({ start, token, end }); return voidHandler ? voidHandler(start, token, end) : { voidedPurchases: voided }; },
    async deleteFirebaseUser(uid) { assert.equal(uid, UID); deleted++; if (failDelete) throw new Error('explicit offline auth fixture'); }
  };
  const economy = new Economy(store, fakeGoogle, env, { now: () => now });
  const seed = async values => { await economy.profile(UID); await store.transaction(async tx => { const p = await tx.get('players/' + owner); tx.set('players/' + owner, { ...p, ...values }); }); };
  const callback = intent => ({ user_id: UID, custom_data: intent.intent_id, ad_unit: AD_UNITS[intent.placement].split('/').at(-1), transaction_id: id(), timestamp: now });
  return { store, economy, env, owner, purchases, voided, voidCalls, voidHandler: value => { voidHandler = value; }, seed, callback, now: () => now, advance: n => { now += n; }, consumeFails: v => { failConsume = v; }, deleteFails: v => { failDelete = v; }, consumed: () => consumed, deleted: () => deleted };
}

test('parallel free-spin requests grant exactly once; UTC reset and operation replay are authoritative', async () => {
  const f = await setup();
  const outcomes = await Promise.allSettled(Array.from({ length: 12 }, () => f.economy.spin(UID, { request_id: id(), source: 'free' })));
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  const op = { request_id: id(), source: 'free' };
  f.advance(86400000);
  const once = await f.economy.spin(UID, op), twice = await f.economy.spin(UID, op);
  assert.deepEqual(once.reward, twice.reward);
  assert.deepEqual(once.profile, twice.profile);
  await assert.rejects(f.economy.spin(UID, { ...op, source: 'diamonds' }), { code: 'request_id_reused' });
  assert.equal(once.profile.day_utc, '2026-10-31');
  assert.equal(once.profile.server_time, f.now());
});

test('diamond spins debit 20 atomically; insufficient balance cannot race into negative currency', async () => {
  const f = await setup(); await f.seed({ diamonds: 40 });
  const outcomes = await Promise.allSettled(Array.from({ length: 8 }, () => f.economy.spin(UID, { request_id: id(), source: 'diamonds' })));
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 2);
  assert.equal((await f.economy.profile(UID)).profile.diamonds, 0);
});

test('pending spin intents reserve both daily slots and verified callback grants once globally', async () => {
  const f = await setup();
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.economy.createIntent(UID, { request_id: id(), placement: 'spin' })));
  const intents = results.filter(x => x.status === 'fulfilled').map(x => x.value);
  assert.equal(intents.length, 2);
  assert.equal((await f.economy.profile(UID)).profile.ad_spins_remaining, 0);
  const cb = f.callback(intents[0]);
  const claims = await Promise.all(Array.from({ length: 8 }, () => f.economy.verifiedReward(cb)));
  assert.equal(claims.filter(x => !x.duplicate).length, 1);
  assert.equal((await f.economy.profile(UID)).profile.ad_spins_used, 1);
  assert.equal((await f.economy.intent(UID, intents[0].intent_id)).status, 'granted');
  await assert.rejects(f.economy.verifiedReward({ ...cb, custom_data: intents[1].intent_id }), { code: 'reward_transaction_reused' });
  await assert.rejects(f.economy.intent('another-user', intents[0].intent_id), { code: 'intent_not_found' });
});

test('wrong ad unit and expired callback cannot grant; reservations expire and release slots', async () => {
  const f = await setup();
  const intent = await f.economy.createIntent(UID, { request_id: id(), placement: 'spin' });
  await assert.rejects(f.economy.verifiedReward({ ...f.callback(intent), ad_unit: AD_UNITS.revive }), { code: 'ad_unit_mismatch' });
  f.advance(600001);
  await assert.rejects(f.economy.verifiedReward(f.callback(intent)), { code: 'intent_expired' });
  assert.equal((await f.economy.intent(UID, intent.intent_id)).status, 'expired');
  assert.equal((await f.economy.profile(UID)).profile.ad_spins_remaining, 2);
});

test('revive is bound to one live run and run finish credits bounded normal coins only once', async () => {
  const f = await setup(), run = await f.economy.startRun(UID, { request_id: id() });
  const intent = await f.economy.createIntent(UID, { request_id: id(), placement: 'revive', run_id: run.run_id });
  await assert.rejects(f.economy.createIntent(UID, { request_id: id(), placement: 'revive', run_id: run.run_id }), { code: 'revive_pending' });
  await f.economy.verifiedReward(f.callback(intent));
  await assert.rejects(f.economy.createIntent(UID, { request_id: id(), placement: 'revive', run_id: run.run_id }), { code: 'revive_unavailable' });
  f.advance(10000);
  const body = { request_id: id(), run_id: run.run_id, score: 1000, distance: 200, coins: 9000 };
  const result = await f.economy.finishRun(UID, body);
  assert.equal(result.coins_awarded, 55);
  assert.equal((await f.economy.finishRun(UID, body)).profile.coins, 55);
  await assert.rejects(f.economy.finishRun(UID, { ...body, request_id: id() }), { code: 'run_not_active' });
});

test('progress currency injection and unowned equip fail; store spends and inventory use are idempotent', async () => {
  const f = await setup(); await f.seed({ coins: 1500, diamonds: 20 });
  await assert.rejects(async () => f.economy.progress(UID, { request_id: id(), progress: { coins: 999999 } }), { code: 'invalid_fields' });
  await assert.rejects(f.economy.progress(UID, { request_id: id(), progress: { selected_style: 'neon' } }), { code: 'style_not_owned' });
  const buy = { request_id: id(), kind: 'style', id: 'sprinter' };
  await f.economy.storePurchase(UID, buy); await f.economy.storePurchase(UID, buy);
  assert.equal((await f.economy.profile(UID)).profile.coins, 300);
  await f.economy.storePurchase(UID, { request_id: id(), kind: 'item', id: 'magnet' });
  const run = await f.economy.startRun(UID, { request_id: id() });
  const use = { request_id: id(), kind: 'use_item', id: 'magnet', run_id: run.run_id };
  await f.economy.storePurchase(UID, use); await f.economy.storePurchase(UID, use);
  assert.equal((await f.economy.profile(UID)).profile.inventory.magnet, 0);
  await f.economy.storePurchase(UID, { request_id: id(), kind: 'exchange', id: 'coins_1000' });
  assert.equal((await f.economy.profile(UID)).profile.coins, 1150);
});

test('concurrent purchase claims grant once globally and encrypted consume outbox retries outside commit', async () => {
  const f = await setup(); f.consumeFails(true);
  const body = { request_id: id(), product_id: 'diamonds_100', purchase_token: 'offline-fixture-sensitive-token' };
  const results = await Promise.all(Array.from({ length: 8 }, () => f.economy.verifyPurchase(UID, body)));
  assert.equal(results.filter(x => x.granted).length, 1);
  assert.equal((await f.economy.profile(UID)).profile.diamonds, 100);
  assert.equal(JSON.stringify([...f.store.data.values()]).includes(body.purchase_token), false);
  assert.equal((await f.store.query('consumeJobs', 'status', 'pending')).length, 1);
  f.consumeFails(false); await f.economy.scheduled();
  assert.equal((await f.store.query('consumeJobs', 'status', 'pending')).length, 0);
  await assert.rejects(f.economy.verifyPurchase(UID, { ...body, purchase_token: 'different-token' }), { code: 'request_id_reused' });
});

test('pending, canceled, wrong-account, multi-quantity and unknown-consumed purchases never grant', async () => {
  const f = await setup();
  for (const [name, properties, code] of [
    ['pending', { state: 'PENDING' }, null], ['canceled', { state: 'CANCELED' }, 'purchase_not_completed'],
    ['wrong-account', { obfuscatedAccountId: 'another-hash' }, 'purchase_account_mismatch'], ['multiple', { quantity: 2 }, 'invalid_purchase_quantity'], ['consumed', { consumed: true }, 'unknown_consumed_purchase']
  ]) {
    f.purchases.set(name, properties);
    const work = f.economy.verifyPurchase(UID, { request_id: id(), product_id: 'diamonds_500', purchase_token: name });
    if (code) await assert.rejects(work, { code }); else assert.equal((await work).granted, false);
  }
  assert.equal((await f.economy.profile(UID)).profile.diamonds, 0);
});

test('delete tombstones before purge, reports Auth failure honestly, retries to completion and removes identity ciphertext', async () => {
  const f = await setup(); await f.seed({ coins: 100 }); f.deleteFails(true);
  await assert.rejects(f.economy.deleteAccount(UID, { auth_time: Math.floor(f.now() / 1000) - 301 }), { code: 'recent_login_required' });
  const pending = await f.economy.deleteAccount(UID, { auth_time: Math.floor(f.now() / 1000) });
  assert.deepEqual(pending, { status: 'deletion_pending', deleted: false, retryable: true });
  assert.equal(await f.store.get('players/' + f.owner), null);
  await assert.rejects(f.economy.profile(UID), { code: 'account_deletion_pending' });
  await assert.rejects(f.economy.spin(UID, { request_id: id(), source: 'free' }), { code: 'account_deletion_pending' });
  f.deleteFails(false); await f.economy.scheduled();
  const job = await f.store.get('deletions/' + f.owner);
  assert.equal(job.status, 'deleted'); assert.equal(job.sealed_uid, undefined);
  assert.equal(JSON.stringify([...f.store.data]).includes(UID), false);
  assert.equal(f.deleted(), 2);
});

test('HTTP boundary requires real-token verifier, blocks client ad spin grants, and verifies signature first', async () => {
  const f = await setup(); let verified = 0, rewarded = 0;
  const deps = { economy: f.economy, verifyToken: async token => { assert.equal(token, 'offline-explicit-fixture'); return { uid: UID, auth_time: Math.floor(f.now() / 1000) }; }, verifySSV: async () => { verified++; throw Object.assign(new Error('offline rejection'), { code: 'invalid_ad_signature', status: 401 }); } };
  const request = (path, body, method = 'POST', auth = true) => new Request('https://subway-runner-api.abirahomod12113.workers.dev' + path, { method, headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer offline-explicit-fixture' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  assert.equal((await handleRequest(request('/v1/profile', null, 'GET', false), f.env, deps)).status, 401);
  assert.equal((await handleRequest(request('/v1/spins', { request_id: id(), source: 'ad' }), f.env, deps)).status, 400);
  const original = f.economy.verifiedReward.bind(f.economy); f.economy.verifiedReward = async cb => { rewarded++; return original(cb); };
  assert.equal((await handleRequest(request('/admob/ssv', null, 'GET', false), f.env, deps)).status, 401);
  assert.equal(verified, 1); assert.equal(rewarded, 0);
  f.deleteFails(true);
  const response = await handleRequest(request('/v1/account/delete', { request_id: id() }), f.env, deps);
  assert.equal(response.status, 202); assert.equal((await response.json()).deleted, false);
});

test('global receipt marker rejects another UID even if a faulty verifier reports a changed account binding', async () => {
  const f = await setup(), token = 'global-token-fixture';
  await f.economy.verifyPurchase(UID, { request_id: id(), product_id: 'diamonds_100', purchase_token: token });
  f.purchases.set(token, { obfuscatedAccountId: await sha256('other-local-user') });
  await assert.rejects(f.economy.verifyPurchase('other-local-user', { request_id: id(), product_id: 'diamonds_100', purchase_token: token }), { code: 'purchase_already_claimed' });
  assert.equal((await f.economy.profile('other-local-user')).profile.diamonds, 0);
});

test('account cleanup waits for encrypted consume work and retries rather than discarding its receipt', async () => {
  const f = await setup(); f.consumeFails(true);
  await f.economy.verifyPurchase(UID, { request_id: id(), product_id: 'diamonds_500', purchase_token: 'deletion-consume-fixture' });
  const pending = await f.economy.deleteAccount(UID, { auth_time: Math.floor(f.now() / 1000) });
  assert.equal(pending.deleted, false); assert.equal(f.deleted(), 0);
  assert.equal((await f.store.query('consumeJobs', 'status', 'pending')).length, 1);
  assert.equal(await f.store.get('players/' + f.owner), null);
  f.consumeFails(false); await f.economy.scheduled();
  assert.equal((await f.store.get('deletions/' + f.owner)).status, 'deleted');
  assert.equal((await f.store.query('consumeJobs', 'status', 'pending')).length, 0);
});

test('trusted void feed reverses unspent diamonds once, removes consume work and denies purchase replay', async () => {
  const f = await setup(); f.consumeFails(true);
  const body = { request_id: id(), product_id: 'diamonds_100', purchase_token: 'refund-unspent' };
  await f.economy.verifyPurchase(UID, body);
  f.voided.push({ purchaseToken: body.purchase_token, voidedTimeMillis: String(f.now()) });
  const first = await f.economy.scheduled();
  assert.equal(first.refunds.reversed, 1);
  assert.equal((await f.economy.profile(UID)).profile.diamonds, 0);
  assert.equal((await f.economy.profile(UID)).profile.diamond_debt, 0);
  assert.equal((await f.store.query('consumeJobs', 'status', 'pending')).length, 0);
  assert.equal((await f.economy.scheduled()).refunds.reversed, 0);
  await assert.rejects(f.economy.verifyPurchase(UID, body), { code: 'purchase_revoked' });
  await assert.rejects(f.economy.verifyPurchase(UID, { ...body, request_id: id() }), { code: 'purchase_revoked' });
});

test('refund of spent diamonds records debt, blocks paid spins/store and new diamond grants repay it first', async () => {
  const f = await setup(), token = 'refund-spent';
  await f.economy.verifyPurchase(UID, { request_id: id(), product_id: 'diamonds_100', purchase_token: token });
  for (let i = 0; i < 3; i++) await f.economy.spin(UID, { request_id: id(), source: 'diamonds' });
  f.voided.push({ purchaseToken: token });
  await f.economy.scheduled();
  let profile = (await f.economy.profile(UID)).profile;
  assert.equal(profile.diamonds, 0); assert.equal(profile.diamond_debt, 60);
  await assert.rejects(f.economy.spin(UID, { request_id: id(), source: 'diamonds' }), { code: 'purchase_debt_outstanding' });
  await f.seed({ coins: 1000 });
  await assert.rejects(f.economy.storePurchase(UID, { request_id: id(), kind: 'item', id: 'magnet' }), { code: 'purchase_debt_outstanding' });
  await f.economy.spin(UID, { request_id: id(), source: 'free' });
  await f.economy.verifyPurchase(UID, { request_id: id(), product_id: 'diamonds_100', purchase_token: 'debt-repayment' });
  profile = (await f.economy.profile(UID)).profile;
  assert.equal(profile.diamonds, 40); assert.equal(profile.diamond_debt, 0);
  await f.economy.spin(UID, { request_id: id(), source: 'diamonds' });
  assert.equal((await f.economy.profile(UID)).profile.diamonds, 20);
});

test('duplicate and concurrent void-feed deliveries reverse each global grant only once', async () => {
  const f = await setup(), token = 'refund-duplicate';
  await f.economy.verifyPurchase(UID, { request_id: id(), product_id: 'diamonds_500', purchase_token: token });
  f.voided.push({ purchaseToken: token }, { purchaseToken: token });
  await Promise.all(Array.from({ length: 5 }, () => f.economy.scheduled()));
  const profile = (await f.economy.profile(UID)).profile;
  assert.equal(profile.diamonds, 0); assert.equal(profile.diamond_debt, 0);
  assert.equal((await f.store.get('purchaseMarkers/' + await sha256(token))).reversed, true);
});

test('unknown refunded tokens are hash-only revocations and cannot later grant from a stale PURCHASED response', async () => {
  const f = await setup(), token = 'unknown-refunded-token';
  f.voided.push({ purchaseToken: token }); await f.economy.scheduled();
  assert.equal(await f.store.get('players/' + f.owner), null);
  assert.equal(JSON.stringify([...f.store.data]).includes(token), false);
  await assert.rejects(f.economy.verifyPurchase(UID, { request_id: id(), product_id: 'diamonds_100', purchase_token: token }), { code: 'purchase_revoked' });
  assert.equal(await f.store.get('players/' + f.owner), null);
});

test('a void committed while purchase verification is in flight prevents its stale grant atomically', async () => {
  const f = await setup(), token = 'in-flight-refund';
  let fetched, release;
  const received = new Promise(resolve => { fetched = resolve; }), resume = new Promise(resolve => { release = resolve; });
  const original = f.economy.play.verifyPurchase;
  f.economy.play.verifyPurchase = async (...args) => { const purchase = await original(...args); fetched(); await resume; return purchase; };
  const verification = f.economy.verifyPurchase(UID, { request_id: id(), product_id: 'diamonds_100', purchase_token: token });
  const rejected = assert.rejects(verification, { code: 'purchase_revoked' });
  await received;
  f.voided.push({ purchaseToken: token }); await f.economy.scheduled();
  release(); await rejected;
  assert.equal(await f.store.get('players/' + f.owner), null);
  assert.equal(await f.store.get('purchaseMarkers/' + await sha256(token)), null);
});

test('paid spending concurrent with a refund cannot escape the wallet reversal/debt transaction', async () => {
  const f = await setup(), token = 'spend-refund-race';
  await f.economy.verifyPurchase(UID, { request_id: id(), product_id: 'diamonds_100', purchase_token: token });
  f.voided.push({ purchaseToken: token });
  const [spin] = await Promise.allSettled([f.economy.spin(UID, { request_id: id(), source: 'diamonds' }), f.economy.scheduled()]);
  const profile = (await f.economy.profile(UID)).profile;
  assert.equal(profile.diamonds, 0);
  assert.equal(profile.diamond_debt, spin.status === 'fulfilled' ? 20 : 0);
  assert.equal((await f.store.get('purchaseMarkers/' + await sha256(token))).reversed, true);
});

test('refund after account deletion never resurrects the profile or records new player debt', async () => {
  const f = await setup(), token = 'deleted-refund';
  await f.economy.verifyPurchase(UID, { request_id: id(), product_id: 'diamonds_100', purchase_token: token });
  await f.economy.deleteAccount(UID, { auth_time: Math.floor(f.now() / 1000) });
  f.voided.push({ purchaseToken: token }); await f.economy.scheduled();
  assert.equal(await f.store.get('players/' + f.owner), null);
  assert.equal((await f.store.get('purchaseMarkers/' + await sha256(token))).reversed, true);
  assert.equal((await f.store.get('deletions/' + f.owner)).status, 'deleted');
});

test('void polling persists bounded-page cursor, follows tokens and overlaps completed windows by 24 hours', async () => {
  const f = await setup();
  f.voidHandler((start, token, end) => {
    assert(end - start <= 30 * 86400000);
    const page = token ? Number(token) : 0;
    return { voidedPurchases: [], tokenPagination: page < 4 ? { nextPageToken: String(page + 1) } : {} };
  });
  const first = await f.economy.scheduled();
  assert.equal(first.refunds.status, 'continuing'); assert.equal(f.voidCalls.length, 3);
  const initial = f.voidCalls[0]; f.advance(300000);
  const second = await f.economy.scheduled();
  assert.equal(second.refunds.status, 'complete');
  assert.deepEqual(f.voidCalls.map(call => call.token), ['', '1', '2', '3', '4']);
  assert.equal(f.voidCalls[3].start, initial.start); assert.equal(f.voidCalls[3].end, initial.end);
  f.voidHandler(() => ({})); await f.economy.scheduled();
  assert.equal(f.voidCalls.at(-1).start, initial.end - 86400000);
  const beforeError = await f.store.get('economyMeta/playVoidedPurchases');
  f.voidHandler(() => { throw new Error('offline Google failure'); }); f.advance(300000);
  assert.equal((await f.economy.scheduled()).refunds.status, 'retryable_error');
  assert.deepEqual(await f.store.get('economyMeta/playVoidedPurchases'), beforeError);
});

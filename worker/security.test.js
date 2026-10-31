import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyFirebaseToken, verifyAdMobCallback, ecdsaDerToRaw, GooglePlayAPI, sealReceipt, openReceipt } from './security.js';

// These are locally generated cryptographic fixtures. No live Google endpoint,
// project credential, private user token, or network fallback is used here.
const text = value => new TextEncoder().encode(value);
const b64 = value => Buffer.from(value).toString('base64url');
const env = { FIREBASE_PROJECT_ID: 'subway-runner-513217', PLAY_PACKAGE_NAME: 'com.subwayrunner.bd', LEDGER_ENCRYPTION_KEY: b64(new Uint8Array(32).fill(17)) };
const now = () => Math.floor(Date.now() / 1000);
const rsa = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', rsa.publicKey), kid: 'local-test', alg: 'RS256', use: 'sig' };
const keyFetch = async url => {
  assert.equal(String(url), 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  return Response.json({ keys: [jwk] });
};
async function firebaseToken(overrides = {}) {
  const issued = now();
  const claims = { aud: env.FIREBASE_PROJECT_ID, iss: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, sub: 'test-user', user_id: 'test-user', exp: issued + 3600, iat: issued, auth_time: issued, ...overrides };
  const message = b64(text(JSON.stringify({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' }))) + '.' + b64(text(JSON.stringify(claims)));
  return message + '.' + b64(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', rsa.privateKey, text(message)));
}

test('Firebase verifies a signed token and rejects another project, tampering, and expired identity', async () => {
  assert.equal((await verifyFirebaseToken(await firebaseToken(), env, keyFetch)).uid, 'test-user');
  await assert.rejects(verifyFirebaseToken(await firebaseToken({ aud: 'other-project' }), env, keyFetch), { code: 'invalid_token' });
  await assert.rejects(verifyFirebaseToken(await firebaseToken({ exp: now() - 1, iat: now() - 3601 }), env, keyFetch), { code: 'expired_token' });
  const token = await firebaseToken();
  const segments = token.split('.');
  segments[2] = (segments[2][0] === 'A' ? 'B' : 'A') + segments[2].slice(1);
  await assert.rejects(verifyFirebaseToken(segments.join('.'), env, keyFetch), { code: 'invalid_token' });
});

function rawToDer(raw) {
  const parts = [raw.subarray(0, 32), raw.subarray(32)].map(value => {
    let first = 0;
    while (first < value.length - 1 && value[first] === 0) first++;
    const integer = value.subarray(first);
    const padded = integer[0] & 128 ? Buffer.concat([Buffer.from([0]), integer]) : Buffer.from(integer);
    return Buffer.concat([Buffer.from([2, padded.length]), padded]);
  });
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}
const ec = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const spki = b64(await crypto.subtle.exportKey('spki', ec.publicKey));
const adKeyFetch = async url => {
  assert.equal(String(url), 'https://www.gstatic.com/admob/reward/verifier-keys.json');
  return Response.json({ keys: [{ keyId: 123, base64: spki }] });
};
async function adURL(extra = '') {
  const message = `ad_network=1&ad_unit=7963379715&custom_data=opaque%2Bintent&reward_amount=1&reward_item=spin&timestamp=${Date.now()}&transaction_id=fixture-tx&user_id=test-user${extra}`;
  const raw = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, ec.privateKey, text(message)));
  assert.deepEqual(ecdsaDerToRaw(rawToDer(raw)), raw);
  return `https://example.test/admob/ssv?${message}&signature=${b64(rawToDer(raw))}&key_id=123`;
}

test('AdMob verifies the exact signed query and rejects changed or appended reward data', async () => {
  const url = await adURL();
  const callback = await verifyAdMobCallback(url, env, adKeyFetch);
  assert.equal(callback.custom_data, 'opaque+intent');
  assert.equal(callback.user_id, 'test-user');
  await assert.rejects(verifyAdMobCallback(url.replace('reward_amount=1', 'reward_amount=9'), env, adKeyFetch), { code: 'invalid_ad_signature' });
  await assert.rejects(verifyAdMobCallback(url + '&custom_data=forged', env, adKeyFetch), { code: 'invalid_ad_callback' });
  await assert.rejects(verifyAdMobCallback(await adURL('&user_id=other-user'), env, adKeyFetch), { code: 'invalid_ad_callback' });
});

test('AdMob rejects malformed or noncanonical DER before signature verification', () => {
  assert.throws(() => ecdsaDerToRaw(Uint8Array.from([0x30, 6, 2, 1, 0, 2, 1, 1])), { code: 'invalid_ad_signature' });
  assert.throws(() => ecdsaDerToRaw(Uint8Array.from([0x30, 7, 2, 2, 0, 1, 2, 1, 1])), { code: 'invalid_ad_signature' });
});

test('receipt encryption round trips and detects tampering or a different encryption key', async () => {
  const sealed = await sealReceipt('local-purchase-token', env);
  assert.ok(!sealed.includes('local-purchase-token'));
  assert.equal(await openReceipt(sealed, env), 'local-purchase-token');
  const tampered = sealed.slice(0, 8) + (sealed[8] === 'A' ? 'B' : 'A') + sealed.slice(9);
  await assert.rejects(openReceipt(tampered, env), { code: 'receipt_unavailable' });
  await assert.rejects(openReceipt(sealed, { ...env, LEDGER_ENCRYPTION_KEY: b64(new Uint8Array(32).fill(18)) }), { code: 'receipt_unavailable' });
});

const pkcs8 = await crypto.subtle.exportKey('pkcs8', rsa.privateKey);
const testServiceEnv = { ...env, GOOGLE_SERVICE_ACCOUNT_EMAIL: 'local-fixture@test-fixture.iam.gserviceaccount.com', GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----` };

test('Google Play adapter scopes server OAuth and maps real purchase states with no client trust', async () => {
  const calls = [];
  const fakeGoogle = async (url, init) => {
    calls.push(String(url));
    if (String(url) === 'https://oauth2.googleapis.com/token') {
      const grant = new URLSearchParams(init.body);
      assert.equal(grant.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const assertion = grant.get('assertion').split('.');
      const claims = JSON.parse(Buffer.from(assertion[1], 'base64url'));
      assert.equal(claims.scope, 'https://www.googleapis.com/auth/androidpublisher');
      assert.ok(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', rsa.publicKey, Buffer.from(assertion[2], 'base64url'), text(assertion.slice(0, 2).join('.'))));
      return Response.json({ access_token: 'local-only-access-token', token_type: 'Bearer', expires_in: 3600 });
    }
    assert.equal(init.headers.authorization, 'Bearer local-only-access-token');
    assert.equal(String(url), 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.subwayrunner.bd/purchases/products/diamonds_100/tokens/local-token');
    return Response.json({ purchaseState: 2, quantity: 1, consumptionState: 0, acknowledgementState: 0, obfuscatedExternalAccountId: 'account-hash' });
  };
  const play = new GooglePlayAPI(testServiceEnv, fakeGoogle);
  const pending = await play.verifyPurchase('diamonds_100', 'local-token');
  assert.equal(pending.state, 'PENDING');
  assert.equal(pending.obfuscatedAccountId, 'account-hash');
  assert.equal(calls.length, 2);
  await assert.rejects(play.verifyPurchase('unlisted', 'local-token'), { code: 'unknown_product' });
  assert.throws(() => new GooglePlayAPI({ ...testServiceEnv, PLAY_PACKAGE_NAME: 'wrong.package' }, fakeGoogle), { code: 'server_configuration' });
});

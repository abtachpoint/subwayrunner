/* Security boundary for Subway Runner's Worker. No client grants are trusted.
 * Secrets are read only from Worker bindings; nothing here logs credentials,
 * identity tokens, receipts, authorization headers or Google's error bodies.
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const FIREBASE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const ADMOB_KEYS = 'https://www.gstatic.com/admob/reward/verifier-keys.json';
const OAUTH_TOKEN = 'https://oauth2.googleapis.com/token';
const PACKAGE = 'com.subwayrunner.bd';
const PRODUCTS = new Set(['diamonds_100', 'diamonds_500', 'diamonds_1200', 'diamonds_2500']);
const PLAY_SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const AUTH_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';
const remoteCaches = new WeakMap();
const oauthCaches = new WeakMap();

export class SecurityError extends Error {
  constructor(code, status = 401, message = 'The request could not be verified.') {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
    this.status = status;
  }
}

function fail(code, status = 401, message) { throw new SecurityError(code, status, message); }
function requireValue(condition, code, status = 401, message) { if (!condition) fail(code, status, message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function utf8(value) { return encoder.encode(value); }
function b64url(bytes) {
  let value = '';
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decode64(value, code = 'invalid_encoding', allowPadding = false) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length < 32768, code);
  const pattern = allowPadding ? /^[A-Za-z0-9_\-+/]+={0,2}$/ : /^[A-Za-z0-9_-]+$/;
  requireValue(pattern.test(value), code);
  const bare = value.replace(/=+$/, '');
  requireValue(bare.length % 4 !== 1, code);
  try {
    const raw = atob(bare.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - bare.length % 4) % 4));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  } catch { return fail(code); }
}
function jsonPart(value) {
  try {
    const parsed = JSON.parse(decoder.decode(decode64(value, 'invalid_token')));
    requireValue(object(parsed), 'invalid_token');
    return parsed;
  } catch { return fail('invalid_token'); }
}
function projectId(env) {
  const id = env.FIREBASE_PROJECT_ID;
  requireValue(typeof id === 'string' && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(id), 'server_configuration', 503);
  return id;
}
function packageName(env) {
  requireValue(env.PLAY_PACKAGE_NAME === PACKAGE, 'server_configuration', 503);
  return PACKAGE;
}
function validateUid(uid) {
  requireValue(typeof uid === 'string' && uid.length > 0 && uid.length <= 128 && !/[\u0000-\u001f\u007f]/.test(uid), 'invalid_identity');
  return uid;
}
function cacheFor(fetcher) {
  let cache = remoteCaches.get(fetcher);
  if (!cache) { cache = new Map(); remoteCaches.set(fetcher, cache); }
  return cache;
}
function cacheLifetime(headers) {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(headers?.get?.('cache-control') || '');
  return Math.min(21600, Math.max(30, match ? Number(match[1]) : 300)) * 1000;
}
async function boundedFetch(fetcher, url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try { return await fetcher(url, { ...init, signal: controller.signal }); }
  catch { return fail('google_unavailable', 503, 'Verification is temporarily unavailable. Please retry.'); }
  finally { clearTimeout(timeout); }
}
async function readJSON(response, code = 'google_unavailable') {
  try {
    const text = await response.text();
    requireValue(text.length <= 262144, code, 503);
    const data = JSON.parse(text);
    requireValue(object(data), code, 503);
    return data;
  } catch (error) {
    if (error instanceof SecurityError) throw error;
    return fail(code, 503);
  }
}
async function publicKeys(url, fetcher, force = false) {
  const cache = cacheFor(fetcher);
  const previous = cache.get(url);
  if (!force && previous?.expires > Date.now()) return previous.data;
  if (previous?.pending) return previous.pending;
  const pending = (async () => {
    const response = await boundedFetch(fetcher, url, { headers: { accept: 'application/json' }, redirect: 'error' });
    requireValue(response.ok, 'google_keys_unavailable', 503);
    const data = await readJSON(response, 'google_keys_unavailable');
    requireValue(Array.isArray(data.keys) && data.keys.length > 0 && data.keys.length <= 100, 'google_keys_unavailable', 503);
    cache.set(url, { data, expires: Date.now() + cacheLifetime(response.headers) });
    return data;
  })();
  cache.set(url, { ...previous, pending });
  try { return await pending; }
  catch (error) { cache.delete(url); throw error; }
}
async function keyedDocument(url, kid, fetcher) {
  let data = await publicKeys(url, fetcher);
  let key = data.keys.find(item => String(item.kid ?? item.keyId) === String(kid));
  if (!key) {
    data = await publicKeys(url, fetcher, true);
    key = data.keys.find(item => String(item.kid ?? item.keyId) === String(kid));
  }
  requireValue(key, 'unknown_signing_key');
  return key;
}

/** Validate a real Firebase ID token. Login state or a Firebase UID from JS is not proof. */
export async function verifyFirebaseToken(token, env, fetcher = fetch) {
  requireValue(typeof token === 'string' && token.length <= 16384, 'invalid_token');
  const segments = token.split('.');
  requireValue(segments.length === 3 && segments.every(Boolean), 'invalid_token');
  const header = jsonPart(segments[0]);
  const claims = jsonPart(segments[1]);
  requireValue(header.alg === 'RS256' && typeof header.kid === 'string' && header.kid.length > 0 && header.kid.length <= 128, 'invalid_token');
  requireValue(!header.jku && !header.x5u && !header.crit && (!header.typ || header.typ === 'JWT'), 'invalid_token');
  const project = projectId(env);
  const now = Math.floor(Date.now() / 1000);
  requireValue(claims.aud === project && claims.iss === `https://securetoken.google.com/${project}`, 'invalid_token');
  validateUid(claims.sub);
  requireValue(Number.isSafeInteger(claims.exp) && claims.exp > now, 'expired_token');
  requireValue(Number.isSafeInteger(claims.iat) && claims.iat <= now + 60 && claims.iat < claims.exp && claims.exp - claims.iat <= 3660, 'invalid_token');
  requireValue(Number.isSafeInteger(claims.auth_time) && claims.auth_time >= 0 && claims.auth_time <= now + 60 && claims.auth_time <= claims.iat + 60, 'invalid_token');
  requireValue(claims.user_id === undefined || claims.user_id === claims.sub, 'invalid_token');
  const jwk = await keyedDocument(FIREBASE_JWKS, header.kid, fetcher);
  requireValue(jwk.kty === 'RSA' && (!jwk.alg || jwk.alg === 'RS256') && (!jwk.use || jwk.use === 'sig'), 'invalid_signing_key');
  requireValue(!['d', 'p', 'q', 'dp', 'dq', 'qi'].some(key => key in jwk), 'invalid_signing_key');
  requireValue(decode64(jwk.n, 'invalid_signing_key').length >= 256, 'invalid_signing_key');
  let key;
  try { key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']); }
  catch { return fail('invalid_signing_key'); }
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode64(segments[2], 'invalid_token'), utf8(`${segments[0]}.${segments[1]}`));
  requireValue(valid, 'invalid_token');
  return { ...claims, uid: claims.sub };
}

function pemBytes(pem, label, error = 'server_configuration') {
  requireValue(typeof pem === 'string', error, 503);
  const normalized = pem.replace(/\\n/g, '\n').trim();
  const match = new RegExp(`^-----BEGIN ${label}-----\\s+([A-Za-z0-9+/=\\s]+)-----END ${label}-----$`).exec(normalized);
  requireValue(match, error, 503);
  return decode64(match[1].replace(/\s/g, ''), error, true);
}
async function digestHex(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', utf8(value))), x => x.toString(16).padStart(2, '0')).join('');
}

/** Service-account OAuth tokens are issued server-side only and scoped per operation. */
export async function getGoogleAccessToken(env, scopes, fetcher = fetch) {
  const email = env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  requireValue(typeof email === 'string' && /^[^\s@]+@[^\s@]+\.gserviceaccount\.com$/.test(email), 'server_configuration', 503);
  requireValue(typeof privateKey === 'string' && privateKey.length < 16384, 'server_configuration', 503);
  const scopeList = Array.isArray(scopes) ? scopes : [scopes];
  requireValue(scopeList.length > 0 && scopeList.length <= 8 && scopeList.every(s => typeof s === 'string' && /^https:\/\/www\.googleapis\.com\/auth\/[A-Za-z.]+$/.test(s)), 'server_configuration', 503);
  const scope = [...new Set(scopeList)].sort().join(' ');
  let oauthCache = oauthCaches.get(fetcher);
  if (!oauthCache) { oauthCache = new Map(); oauthCaches.set(fetcher, oauthCache); }
  const cacheKey = await digestHex(email + '\n' + privateKey + '\n' + scope);
  const cached = oauthCache.get(cacheKey);
  if (cached?.expires > Date.now() + 60000) return cached.token;
  if (cached?.pending) return cached.pending;
  const pending = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const input = b64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))) + '.' +
      b64url(utf8(JSON.stringify({ iss: email, scope, aud: OAUTH_TOKEN, iat: now, exp: now + 3600 })));
    let key;
    try { key = await crypto.subtle.importKey('pkcs8', pemBytes(privateKey, 'PRIVATE KEY'), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); }
    catch { return fail('server_configuration', 503); }
    const signature = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(input)));
    const response = await boundedFetch(fetcher, OAUTH_TOKEN, {
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: input + '.' + b64url(signature) }).toString()
    });
    requireValue(response.ok, response.status === 400 || response.status === 401 ? 'google_credentials' : 'google_unavailable', 503);
    const data = await readJSON(response);
    requireValue(typeof data.access_token === 'string' && data.access_token.length > 0 && data.access_token.length < 16384 && (!data.token_type || data.token_type.toLowerCase() === 'bearer'), 'google_unavailable', 503);
    requireValue(Number.isFinite(data.expires_in) && data.expires_in > 0, 'google_unavailable', 503);
    oauthCache.set(cacheKey, { token: data.access_token, expires: Date.now() + Math.min(3600, data.expires_in) * 1000 });
    if (oauthCache.size > 32) oauthCache.delete(oauthCache.keys().next().value);
    return data.access_token;
  })();
  oauthCache.set(cacheKey, { pending });
  try { return await pending; }
  catch (error) { oauthCache.delete(cacheKey); throw error; }
}

function purchaseToken(token) {
  requireValue(typeof token === 'string' && token.length > 0 && token.length <= 4096 && token.trim() === token && !/[\u0000-\u001f\u007f]/.test(token), 'invalid_purchase_token', 400);
  return token;
}
function productId(product) {
  requireValue(PRODUCTS.has(product), 'unknown_product', 400);
  return product;
}

export class GooglePlayAPI {
  constructor(env, fetcher = fetch) { this.env = env; this.fetcher = fetcher; this.package = packageName(env); }
  async request(url, method = 'GET', data) {
    const accessToken = await getGoogleAccessToken(this.env, [PLAY_SCOPE], this.fetcher);
    const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
    if (data !== undefined) headers['content-type'] = 'application/json';
    const response = await boundedFetch(this.fetcher, url, { method, headers, redirect: 'error', ...(data !== undefined ? { body: JSON.stringify(data) } : {}) });
    if (response.status === 404 || response.status === 410) fail('purchase_not_found', 400);
    requireValue(response.ok, response.status === 403 ? 'google_permission_denied' : 'google_unavailable', 503);
    if (response.status === 204) return {};
    const text = await response.text();
    if (!text.trim()) return {};
    try {
      requireValue(text.length <= 262144, 'google_unavailable', 503);
      const result = JSON.parse(text);
      requireValue(object(result), 'google_unavailable', 503);
      return result;
    } catch (error) { if (error instanceof SecurityError) throw error; return fail('google_unavailable', 503); }
  }
  productURL(product, token) {
    return `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.package)}/purchases/products/${encodeURIComponent(productId(product))}/tokens/${encodeURIComponent(purchaseToken(token))}`;
  }
  async verifyPurchase(product, token) {
    const data = await this.request(this.productURL(product, token));
    requireValue([0, 1, 2].includes(data.purchaseState), 'google_invalid_purchase', 503);
    const quantity = data.quantity === undefined ? 1 : data.quantity;
    requireValue(Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 999, 'google_invalid_purchase', 503);
    requireValue(data.consumptionState === 0 || data.consumptionState === 1, 'google_invalid_purchase', 503);
    requireValue(data.acknowledgementState === 0 || data.acknowledgementState === 1, 'google_invalid_purchase', 503);
    return {
      state: ['PURCHASED', 'CANCELED', 'PENDING'][data.purchaseState], productId: product, quantity,
      obfuscatedAccountId: typeof data.obfuscatedExternalAccountId === 'string' ? data.obfuscatedExternalAccountId : null,
      consumed: data.consumptionState === 1, acknowledged: data.acknowledgementState === 1,
      orderId: typeof data.orderId === 'string' ? data.orderId : null,
      purchaseTimeMillis: typeof data.purchaseTimeMillis === 'string' ? Number(data.purchaseTimeMillis) : null
    };
  }
  async consumePurchase(product, token) {
    try { await this.request(this.productURL(product, token) + ':consume', 'POST'); }
    catch (error) {
      // A successful consume response can be lost. Confirm Google's current
      // state before treating a retry/already-consumed error as a success.
      try {
        const current = await this.verifyPurchase(product, token);
        if (current.state === 'PURCHASED' && current.consumed) return;
      } catch { /* Preserve the original sanitized operation error. */ }
      throw error;
    }
  }
  async listVoidedPurchases(startMillis, pageToken = '', endMillis) {
    requireValue(Number.isSafeInteger(startMillis) && startMillis >= 0, 'invalid_time', 400);
    const url = new URL(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(this.package)}/purchases/voidedpurchases`);
    url.searchParams.set('startTime', String(startMillis));
    if (endMillis !== undefined) {
      requireValue(Number.isSafeInteger(endMillis) && endMillis >= startMillis && endMillis <= Date.now() && endMillis - startMillis <= 30 * 86400000, 'invalid_time', 400);
      url.searchParams.set('endTime', String(endMillis));
    }
    url.searchParams.set('maxResults', '1000');
    if (pageToken) url.searchParams.set('token', String(pageToken));
    return this.request(url.toString());
  }
  async deleteFirebaseUser(uid) {
    validateUid(uid);
    const accessToken = await getGoogleAccessToken(this.env, [AUTH_SCOPE], this.fetcher);
    const response = await boundedFetch(this.fetcher, `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(projectId(this.env))}/accounts:delete`, {
      method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ localId: uid })
    });
    // USER_NOT_FOUND is an idempotent success, but parse only this stable code.
    if (!response.ok) {
      let missing = false;
      try { const body = await readJSON(response); missing = body.error?.message === 'USER_NOT_FOUND'; } catch { /* sanitized below */ }
      requireValue(missing, response.status === 403 ? 'google_permission_denied' : 'google_unavailable', 503);
    }
  }
}

/** Converts canonical positive-integer ECDSA DER to WebCrypto's P1363 r||s. */
export function ecdsaDerToRaw(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  requireValue(bytes.length >= 8 && bytes.length <= 72 && bytes[0] === 0x30 && bytes[1] === bytes.length - 2 && bytes[1] < 0x80, 'invalid_ad_signature');
  let offset = 2;
  const output = new Uint8Array(64);
  for (let component = 0; component < 2; component++) {
    requireValue(bytes[offset++] === 2 && offset < bytes.length, 'invalid_ad_signature');
    let length = bytes[offset++];
    requireValue(length > 0 && length <= 33 && offset + length <= bytes.length && !(bytes[offset] & 0x80), 'invalid_ad_signature');
    if (bytes[offset] === 0 && length > 1) {
      requireValue(bytes[offset + 1] & 0x80, 'invalid_ad_signature');
      offset++; length--;
    }
    requireValue(length <= 32 && bytes.slice(offset, offset + length).some(value => value !== 0), 'invalid_ad_signature');
    output.set(bytes.subarray(offset, offset + length), component * 32 + 32 - length);
    offset += length;
  }
  requireValue(offset === bytes.length, 'invalid_ad_signature');
  return output;
}

/** Verify AdMob's exact raw signed query; never reserialize parsed parameters. */
export async function verifyAdMobCallback(url, env, fetcher = fetch) {
  let parsed;
  try { parsed = new URL(url); } catch { return fail('invalid_ad_callback', 400); }
  requireValue(parsed.protocol === 'https:' && !parsed.hash, 'invalid_ad_callback', 400);
  const query = parsed.search.slice(1);
  requireValue(query.length > 0 && query.length <= 16384 && /^[\x21-\x7e]+$/.test(query), 'invalid_ad_callback', 400);
  const chunks = query.split('&');
  requireValue(chunks.length >= 5 && chunks.length <= 20, 'invalid_ad_callback', 400);
  const params = Object.create(null);
  const keys = [];
  for (const part of chunks) {
    const separator = part.indexOf('=');
    requireValue(separator > 0, 'invalid_ad_callback', 400);
    const name = part.slice(0, separator);
    requireValue(/^[a-z_]{1,40}$/.test(name) && !(name in params), 'invalid_ad_callback', 400);
    try { params[name] = decodeURIComponent(part.slice(separator + 1).replace(/\+/g, ' ')); }
    catch { return fail('invalid_ad_callback', 400); }
    keys.push(name);
  }
  // Only signature/key_id may be outside the signature. Additional unsigned
  // user_id/custom_data fields must never influence the reward lookup.
  requireValue(keys.at(-2) === 'signature' && keys.at(-1) === 'key_id', 'invalid_ad_callback', 400);
  const marker = query.indexOf('&signature=');
  requireValue(marker > 0 && /^\d{1,32}$/.test(params.key_id), 'invalid_ad_callback', 400);
  const signed = query.slice(0, marker);
  const selected = await keyedDocument(ADMOB_KEYS, params.key_id, fetcher);
  const spki = selected.pem ? pemBytes(selected.pem, 'PUBLIC KEY', 'invalid_ad_signing_key') : decode64(selected.base64, 'invalid_ad_signing_key', true);
  let key;
  try { key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']); }
  catch { return fail('invalid_ad_signing_key'); }
  const signature = ecdsaDerToRaw(decode64(params.signature, 'invalid_ad_signature', true));
  const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, utf8(signed));
  requireValue(valid, 'invalid_ad_signature');
  requireValue(/^\d{13}$/.test(params.timestamp || ''), 'invalid_ad_timestamp', 400);
  const timestamp = Number(params.timestamp);
  const now = Date.now();
  requireValue(timestamp >= now - 600000 && timestamp <= now + 60000, 'expired_ad_callback', 400);
  validateUid(params.user_id);
  requireValue(typeof params.transaction_id === 'string' && /^[A-Za-z0-9._:-]{1,160}$/.test(params.transaction_id), 'invalid_ad_callback', 400);
  requireValue(typeof params.custom_data === 'string' && params.custom_data.length > 0 && params.custom_data.length <= 1024 && !/[\u0000-\u001f\u007f]/.test(params.custom_data), 'invalid_ad_callback', 400);
  requireValue(typeof params.ad_unit === 'string' && params.ad_unit.length > 0 && params.ad_unit.length <= 128, 'invalid_ad_callback', 400);
  requireValue(/^\d{1,9}$/.test(params.reward_amount || '') && Number(params.reward_amount) > 0, 'invalid_ad_callback', 400);
  return { ...params, timestamp };
}

async function ledgerKey(env, usages) {
  let bytes;
  try { bytes = decode64(env.LEDGER_ENCRYPTION_KEY, 'server_configuration', true); }
  catch { return fail('server_configuration', 503); }
  requireValue(bytes.length === 32, 'server_configuration', 503);
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, usages);
}
export async function sealReceipt(token, env) {
  purchaseToken(token);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await ledgerKey(env, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(`subway-runner:receipt:v1:${packageName(env)}`) }, key, utf8(token)));
  const packed = new Uint8Array(iv.length + encrypted.length);
  packed.set(iv); packed.set(encrypted, iv.length);
  return 'v1.' + b64url(packed);
}
export async function openReceipt(value, env) {
  requireValue(typeof value === 'string' && value.startsWith('v1.') && value.length <= 8192, 'receipt_unavailable', 503);
  const bytes = decode64(value.slice(3), 'receipt_unavailable');
  requireValue(bytes.length >= 29, 'receipt_unavailable', 503);
  try {
    const key = await ledgerKey(env, ['decrypt']);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: utf8(`subway-runner:receipt:v1:${packageName(env)}`) }, key, bytes.slice(12));
    return purchaseToken(decoder.decode(plaintext));
  } catch { return fail('receipt_unavailable', 503); }
}

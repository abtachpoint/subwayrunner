import { Firestore } from './firestore.js';
import { Economy, EconomyError, fields } from './economy.js';
import { catalog } from './catalog.js';
import { GooglePlayAPI, verifyFirebaseToken, verifyAdMobCallback } from './security.js';

const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: HEADERS }); }
async function bodyJSON(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new EconomyError('json_required', 415);
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > 32768)) throw new EconomyError('body_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new EconomyError('invalid_body');
  const chunks = []; let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > 32768) { await reader.cancel(); throw new EconomyError('body_too_large', 413); }
    chunks.push(value);
  }
  const joined = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined)); }
  catch { throw new EconomyError('invalid_json'); }
}
function production(env) { return { economy: new Economy(new Firestore(env), new GooglePlayAPI(env), env), verifyToken: verifyFirebaseToken, verifySSV: verifyAdMobCallback }; }

// Dependency injection is an explicit source-level test seam. Production fetch
// and cron always instantiate Firestore plus the actual Google security module.
export async function handleRequest(request, env, dependencies) {
  try {
    const url = new URL(request.url), route = url.pathname;
    if (route === '/health' && request.method === 'GET') return json({ status: 'ok', service: 'subway-runner-api' });
    if (route === '/v1/catalog' && request.method === 'GET') return json(catalog());
    const services = dependencies || production(env), { economy } = services;
    if (route === '/admob/ssv' && request.method === 'GET') {
      // Authenticate Google's exact query bytes BEFORE trusting any callback
      // field, looking up an intent, or mutating the reward ledger.
      const callback = await services.verifySSV(request.url, env);
      return json(await economy.verifiedReward(callback));
    }
    const known = ['/v1/profile', '/v1/progress', '/v1/runs/start', '/v1/runs/finish', '/v1/spins', '/v1/store', '/v1/rewards/intents', '/v1/purchases/verify', '/v1/account/delete'].includes(route) || /^\/v1\/rewards\/intents\/[^/]+$/.test(route);
    if (!known) throw new EconomyError('not_found', 404);
    const auth = /^Bearer ([^\s]{1,16384})$/.exec(request.headers.get('authorization') || '');
    if (!auth) throw new EconomyError('authentication_required', 401);
    const claims = await services.verifyToken(auth[1], env), uid = claims.uid;
    if (route === '/v1/profile' && request.method === 'GET') return json(await economy.profile(uid));
    if (route.startsWith('/v1/rewards/intents/') && request.method === 'GET') return json(await economy.intent(uid, route.split('/').at(-1)));
    const methods = { '/v1/progress': 'PUT', '/v1/runs/start': 'POST', '/v1/runs/finish': 'POST', '/v1/spins': 'POST', '/v1/store': 'POST', '/v1/rewards/intents': 'POST', '/v1/purchases/verify': 'POST', '/v1/account/delete': 'POST' };
    if (methods[route] !== request.method) throw new EconomyError('method_not_allowed', 405);
    const body = await bodyJSON(request);
    const handlers = {
      '/v1/progress': () => economy.progress(uid, body), '/v1/runs/start': () => economy.startRun(uid, body), '/v1/runs/finish': () => economy.finishRun(uid, body),
      '/v1/spins': () => economy.spin(uid, body), '/v1/store': () => economy.storePurchase(uid, body), '/v1/rewards/intents': () => economy.createIntent(uid, body),
      '/v1/purchases/verify': () => economy.verifyPurchase(uid, body),
      '/v1/account/delete': () => { fields(body, ['request_id'], ['request_id']); if (!/^[A-Za-z0-9_-]{8,128}$/.test(body.request_id || '')) throw new EconomyError('invalid_request_id'); return economy.deleteAccount(uid, claims); }
    };
    const result = await handlers[route]();
    return json(result, route === '/v1/account/delete' && !result.deleted ? 202 : 200);
  } catch (error) {
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
    const code = typeof error.code === 'string' && /^[a-z0-9_]{1,80}$/.test(error.code) ? error.code : 'service_unavailable';
    // No receipt, identity token, Google body, stack or credential is reflected.
    return json({ error: { code, message: status >= 500 ? 'The service is temporarily unavailable. Please retry.' : 'The request could not be completed.', retryable: status >= 500 || status === 429 } }, status);
  }
}
export default {
  fetch(request, env) { return handleRequest(request, env); },
  async scheduled(_event, env) { await production(env).economy.scheduled(); }
};

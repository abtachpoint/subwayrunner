import { PRODUCTS, STYLES, ITEMS, SPIN_OUTCOMES } from './catalog.js';
import { sealReceipt, openReceipt } from './security.js';

export class EconomyError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const assert = (condition, code, status = 400) => { if (!condition) throw new EconomyError(code, status); };
const copy = value => structuredClone(value);
const INTENT_LIFETIME = 600000;
const MAX_BALANCE = 1000000000;
const VOIDED_CURSOR = 'economyMeta/playVoidedPurchases';
const VOIDED_LOOKBACK = 30 * 86400000;
const VOIDED_OVERLAP = 86400000;
const VOIDED_MAX_PAGES = 3;
export const AD_UNITS = Object.freeze({ revive: 'ca-app-pub-1379059201302335/6015873225', spin: 'ca-app-pub-1379059201302335/7963379715' });
export async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), v => v.toString(16).padStart(2, '0')).join('');
}
const day = time => new Date(time).toISOString().slice(0, 10);
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
const integer = (value, min, max, code = 'invalid_number') => assert(Number.isSafeInteger(value) && value >= min && value <= max, code);
export function fields(body, allowed, required = []) {
  assert(body !== null && typeof body === 'object' && !Array.isArray(body), 'invalid_body');
  assert(Object.keys(body).every(key => allowed.includes(key)) && required.every(key => key in body), 'invalid_fields');
}
function requestId(value) { assert(typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value), 'invalid_request_id'); return value; }
function opaqueId(value) { assert(typeof value === 'string' && /^[a-f0-9-]{32,64}$/.test(value), 'invalid_id'); return value; }
function newProfile(now) {
  return { version: 1, coins: 0, diamonds: 0, diamond_debt: 0, inventory: { magnet: 0, shield: 0 }, owned_styles: ['courier', 'skater'], selected_style: 'courier', high_score: 0, best_distance: 0,
    settings: { music: true, sfx: true, quality: 'medium' }, tutorial_seen: false,
    free_spin_day: '', ad_spins_day: day(now), ad_spins_used: 0, spin_reservations: {}, active_run: null, created_at: now, updated_at: now };
}
function normalize(profile, now) {
  profile.diamond_debt ??= 0;
  if (profile.ad_spins_day !== day(now)) { profile.ad_spins_day = day(now); profile.ad_spins_used = 0; profile.spin_reservations = {}; }
  for (const [id, expires] of Object.entries(profile.spin_reservations || {})) if (expires <= now) delete profile.spin_reservations[id];
  return profile;
}
function publicProfile(profile, accountHash, now) {
  const value = copy(profile);
  delete value.spin_reservations;
  delete value.active_run;
  value.obfuscated_account_id = accountHash;
  value.free_spins_remaining = profile.free_spin_day === day(now) ? 0 : 1;
  value.ad_spins_remaining = Math.max(0, 2 - profile.ad_spins_used - Object.keys(profile.spin_reservations || {}).length);
  value.day_utc = day(now);
  value.server_time = now;
  return value;
}
function credit(profile, currency, amount) {
  assert(['coins', 'diamonds'].includes(currency) && Number.isSafeInteger(amount) && amount >= 0, 'invalid_grant', 503);
  if (currency === 'diamonds') {
    const debt = profile.diamond_debt ?? 0;
    assert(Number.isSafeInteger(debt) && debt >= 0, 'invalid_balance', 503);
    const repaid = Math.min(debt, amount);
    profile.diamond_debt = debt - repaid;
    amount -= repaid;
  }
  assert(Number.isSafeInteger(profile[currency]) && profile[currency] + amount <= MAX_BALANCE, 'balance_limit', 409);
  profile[currency] += amount;
}
function debit(profile, currency, amount) {
  assert(!(profile.diamond_debt > 0), 'purchase_debt_outstanding', 409);
  assert(profile[currency] >= amount, 'insufficient_' + currency, 409); profile[currency] -= amount;
}
function spinReward(profile) {
  const draw = crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
  let cumulative = 0;
  const reward = copy(SPIN_OUTCOMES.find(item => { cumulative += item.probability; return draw < cumulative; }) || SPIN_OUTCOMES.at(-1));
  delete reward.probability;
  if (reward.kind === 'coins') credit(profile, 'coins', reward.amount);
  else if (reward.kind === 'item') profile.inventory[reward.item_id] += reward.amount;
  else if (!profile.owned_styles.includes(reward.style_id)) profile.owned_styles.push(reward.style_id);
  else { reward.duplicate = true; reward.compensation = { kind: 'coins', amount: 300 }; credit(profile, 'coins', 300); }
  return reward;
}

/** The only balance writer. The store must provide serializable transactions. */
export class Economy {
  constructor(store, play, env, { now = () => Date.now() } = {}) { this.store = store; this.play = play; this.env = env; this.now = now; }
  async identity(uid) { const hash = await sha256(uid); return { hash, base: 'players/' + hash, tombstone: 'deletions/' + hash }; }
  async profile(uid) {
    const who = await this.identity(uid); const now = this.now();
    return this.store.transaction(async tx => {
      assert(!await tx.get(who.tombstone), 'account_deletion_pending', 403);
      const profile = normalize(await tx.get(who.base) || newProfile(now), now);
      tx.set(who.base, profile);
      return { profile: publicProfile(profile, who.hash, now) };
    });
  }
  async mutate(uid, body, operation, action) {
    requestId(body.request_id);
    const who = await this.identity(uid), now = this.now();
    const opPath = who.base + '/operations/' + await sha256(body.request_id);
    const fingerprint = await sha256(operation + '\n' + canonical(body));
    return this.store.transaction(async tx => {
      assert(!await tx.get(who.tombstone), 'account_deletion_pending', 403);
      const profile = normalize(await tx.get(who.base) || newProfile(now), now);
      const previous = await tx.get(opPath);
      if (previous) {
        assert(previous.fingerprint === fingerprint, 'request_id_reused', 409);
        return { ...previous.result, profile: publicProfile(profile, who.hash, now) };
      }
      const result = await action({ tx, who, profile, now });
      profile.updated_at = now;
      tx.set(who.base, profile);
      tx.set(opPath, { fingerprint, result, created_at: now });
      return { ...result, profile: publicProfile(profile, who.hash, now) };
    });
  }
  progress(uid, body) {
    fields(body, ['request_id', 'progress'], ['request_id', 'progress']);
    fields(body.progress, ['selected_style', 'high_score', 'best_distance', 'settings', 'tutorial_seen']);
    return this.mutate(uid, body, 'progress', ({ profile }) => {
      const p = body.progress;
      if ('selected_style' in p) { assert(profile.owned_styles.includes(p.selected_style), 'style_not_owned', 409); profile.selected_style = p.selected_style; }
      if ('high_score' in p) { integer(p.high_score, 0, 1000000000); profile.high_score = Math.max(profile.high_score, p.high_score); }
      if ('best_distance' in p) { integer(p.best_distance, 0, 10000000); profile.best_distance = Math.max(profile.best_distance, p.best_distance); }
      if ('tutorial_seen' in p) { assert(typeof p.tutorial_seen === 'boolean', 'invalid_progress'); profile.tutorial_seen = p.tutorial_seen; }
      if ('settings' in p) {
        fields(p.settings, ['music', 'sfx', 'quality']);
        for (const key of ['music', 'sfx']) if (key in p.settings) assert(typeof p.settings[key] === 'boolean', 'invalid_settings');
        if ('quality' in p.settings) assert(['low', 'medium', 'high'].includes(p.settings.quality), 'invalid_settings');
        profile.settings = { ...profile.settings, ...p.settings };
      }
      return { saved: true };
    });
  }
  startRun(uid, body) {
    fields(body, ['request_id'], ['request_id']);
    const runId = crypto.randomUUID();
    return this.mutate(uid, body, 'run_start', async ({ tx, who, profile, now }) => {
      if (profile.active_run) {
        const oldPath = who.base + '/runs/' + profile.active_run;
        const old = await tx.get(oldPath);
        if (old && !old.finished_at) tx.set(oldPath, { ...old, abandoned_at: now });
      }
      tx.set(who.base + '/runs/' + runId, { started_at: now, revived: false, finished_at: null, abandoned_at: null, revive_intent: null });
      profile.active_run = runId;
      return { run_id: runId };
    });
  }
  finishRun(uid, body) {
    fields(body, ['request_id', 'run_id', 'score', 'distance', 'coins'], ['request_id', 'run_id', 'score', 'distance', 'coins']);
    opaqueId(body.run_id); integer(body.score, 0, 1000000000); integer(body.distance, 0, 10000000); integer(body.coins, 0, 100000);
    return this.mutate(uid, body, 'run_finish', async ({ tx, who, profile, now }) => {
      const path = who.base + '/runs/' + body.run_id, run = await tx.get(path);
      assert(run && !run.finished_at && !run.abandoned_at && profile.active_run === body.run_id, 'run_not_active', 409);
      const seconds = (now - run.started_at) / 1000;
      assert(seconds >= 1 && seconds <= 2700, 'run_time_invalid', 409);
      assert(body.distance <= Math.ceil(seconds * 45 + 30) && body.score <= body.distance * 100 + body.coins * 100 + 1000, 'run_out_of_bounds', 409);
      const awarded = Math.min(body.coins, 500, Math.floor(seconds * 5 + 5), Math.floor(body.distance / 2 + 10));
      credit(profile, 'coins', awarded);
      profile.high_score = Math.max(profile.high_score, body.score); profile.best_distance = Math.max(profile.best_distance, body.distance); profile.active_run = null;
      tx.set(path, { ...run, finished_at: now, score: body.score, distance: body.distance, coins_awarded: awarded });
      return { run_id: body.run_id, coins_awarded: awarded };
    });
  }
  spin(uid, body) {
    fields(body, ['request_id', 'source'], ['request_id', 'source']); assert(['free', 'diamonds'].includes(body.source), 'invalid_spin_source');
    return this.mutate(uid, body, 'spin', ({ profile, now }) => {
      if (body.source === 'free') { assert(profile.free_spin_day !== day(now), 'daily_free_spin_used', 409); profile.free_spin_day = day(now); }
      else debit(profile, 'diamonds', 20);
      return { reward: spinReward(profile), source: body.source };
    });
  }
  storePurchase(uid, body) {
    fields(body, ['request_id', 'kind', 'id', 'quantity', 'run_id'], ['request_id', 'kind', 'id']);
    const quantity = body.quantity ?? 1; integer(quantity, 1, 99);
    assert(['style', 'character', 'item', 'exchange', 'use_item'].includes(body.kind), 'invalid_store_kind');
    const item = (['item', 'exchange', 'use_item'].includes(body.kind) ? ITEMS : STYLES).find(item => item.id === body.id);
    if (body.kind === 'exchange') assert(body.id === 'coins_1000', 'unknown_store_item');
    if (['item', 'use_item'].includes(body.kind)) assert(['magnet', 'shield'].includes(body.id), 'unknown_store_item');
    if (body.run_id !== undefined) opaqueId(body.run_id);
    assert(item, 'unknown_store_item');
    if (['style', 'character', 'use_item'].includes(body.kind)) assert(quantity === 1, 'invalid_quantity');
    return this.mutate(uid, body, 'store', async ({ tx, who, profile }) => {
      if (body.kind === 'use_item') {
        assert(profile.active_run && (!body.run_id || body.run_id === profile.active_run), 'run_not_active', 409);
        const run = await tx.get(who.base + '/runs/' + profile.active_run);
        assert(run && !run.finished_at && !run.abandoned_at, 'run_not_active', 409);
        assert(profile.inventory[item.id] > 0, 'item_unavailable', 409);
        profile.inventory[item.id]--;
        return { consumed: { id: item.id, quantity: 1 }, run_id: profile.active_run };
      }
      if (['style', 'character'].includes(body.kind)) {
        assert(!profile.owned_styles.includes(item.id), 'already_owned', 409);
        if (item.currency !== 'free') debit(profile, item.currency, item.cost);
        profile.owned_styles.push(item.id);
      } else {
        debit(profile, item.currency, item.cost * quantity);
        if (item.id === 'coins_1000') credit(profile, 'coins', 1000 * quantity);
        else { assert(profile.inventory[item.id] + quantity <= 100000, 'inventory_limit', 409); profile.inventory[item.id] += quantity; }
      }
      return { purchased: { kind: body.kind, id: item.id, quantity } };
    });
  }
  createIntent(uid, body) {
    fields(body, ['request_id', 'placement', 'run_id'], ['request_id', 'placement']);
    assert(['revive', 'spin'].includes(body.placement), 'invalid_placement');
    if (body.placement === 'revive') opaqueId(body.run_id);
    else assert(body.run_id === undefined, 'invalid_fields');
    const intentId = crypto.randomUUID();
    return this.mutate(uid, body, 'reward_intent', async ({ tx, who, profile, now }) => {
      if (body.placement === 'spin') {
        assert(profile.ad_spins_used + Object.keys(profile.spin_reservations).length < 2, 'daily_ad_spin_limit', 409);
        profile.spin_reservations[intentId] = now + INTENT_LIFETIME;
      } else {
        const path = who.base + '/runs/' + body.run_id, run = await tx.get(path);
        assert(run && !run.finished_at && !run.abandoned_at && profile.active_run === body.run_id && !run.revived, 'revive_unavailable', 409);
        if (run.revive_intent) { const pending = await tx.get(who.base + '/intents/' + run.revive_intent); assert(!pending || pending.expires_at <= now, 'revive_pending', 409); }
        tx.set(path, { ...run, revive_intent: intentId });
      }
      const intent = { placement: body.placement, run_id: body.run_id || null, created_at: now, expires_at: now + INTENT_LIFETIME, day_utc: day(now), status: 'pending' };
      tx.set(who.base + '/intents/' + intentId, intent);
      return { intent_id: intentId, custom_data: intentId, user_id: uid, ad_unit: AD_UNITS[body.placement], ...intent };
    });
  }
  async intent(uid, id) {
    opaqueId(id);
    const who = await this.identity(uid), now = this.now();
    return this.store.transaction(async tx => {
      assert(!await tx.get(who.tombstone), 'account_deletion_pending', 403);
      const intent = await tx.get(who.base + '/intents/' + id); assert(intent, 'intent_not_found', 404);
      const profile = normalize(await tx.get(who.base) || newProfile(now), now);
      return { intent_id: id, ...intent, status: intent.status === 'pending' && intent.expires_at <= now ? 'expired' : intent.status, profile: publicProfile(profile, who.hash, now) };
    });
  }
  /** Call ONLY after verifyAdMobCallback authenticated the unmodified URL. */
  async verifiedReward(callback) {
    opaqueId(callback.custom_data);
    const who = await this.identity(callback.user_id), marker = 'ssvMarkers/' + await sha256(callback.transaction_id), now = this.now();
    return this.store.transaction(async tx => {
      const previous = await tx.get(marker);
      if (previous) { assert(previous.owner_hash === who.hash && previous.intent_hash === await sha256(callback.custom_data), 'reward_transaction_reused', 409); return { accepted: true, duplicate: true }; }
      assert(!await tx.get(who.tombstone), 'account_deletion_pending', 403);
      const path = who.base + '/intents/' + callback.custom_data, intent = await tx.get(path);
      assert(intent, 'intent_not_found', 404);
      const allowedUnit = AD_UNITS[intent.placement];
      // AdMob SSV documents the numeric ad-unit ID; the Android SDK uses the
      // full ca-app-pub ID. Accept only these two representations of this unit.
      assert(callback.ad_unit === allowedUnit || callback.ad_unit === allowedUnit.split('/').at(-1), 'ad_unit_mismatch', 403);
      assert(callback.timestamp >= intent.created_at - 60000 && callback.timestamp <= intent.expires_at && now <= intent.expires_at, 'intent_expired', 409);
      assert(intent.status === 'pending', 'intent_already_used', 409);
      const profile = normalize(await tx.get(who.base) || newProfile(now), now);
      let reward;
      if (intent.placement === 'spin') {
        assert(intent.day_utc === day(now) && profile.spin_reservations[callback.custom_data] && profile.ad_spins_used < 2, 'daily_ad_spin_limit', 409);
        delete profile.spin_reservations[callback.custom_data]; profile.ad_spins_used++;
        reward = spinReward(profile);
      } else {
        const runPath = who.base + '/runs/' + intent.run_id, run = await tx.get(runPath);
        assert(run && !run.finished_at && !run.abandoned_at && !run.revived && profile.active_run === intent.run_id && run.revive_intent === callback.custom_data, 'revive_unavailable', 409);
        tx.set(runPath, { ...run, revived: true, revived_at: now, revive_intent: null });
        reward = { kind: 'revive', run_id: intent.run_id };
      }
      tx.set(path, { ...intent, status: 'granted', reward, granted_at: now });
      tx.set(who.base, { ...profile, updated_at: now });
      tx.set(marker, { owner_hash: who.hash, intent_hash: await sha256(callback.custom_data), granted_at: now });
      return { accepted: true, duplicate: false };
    });
  }
  async verifyPurchase(uid, body) {
    fields(body, ['request_id', 'product_id', 'purchase_token'], ['request_id', 'product_id', 'purchase_token']);
    requestId(body.request_id); assert(Object.hasOwn(PRODUCTS, body.product_id), 'unknown_product');
    assert(typeof body.purchase_token === 'string' && body.purchase_token.length > 0 && body.purchase_token.length <= 4096, 'invalid_purchase_token');
    const who = await this.identity(uid), tokenHash = await sha256(body.purchase_token), markerPath = 'purchaseMarkers/' + tokenHash, jobPath = 'consumeJobs/' + tokenHash;
    // Refuse tombstoned identities and known voids before making a paid API call.
    assert(!await this.store.get(who.tombstone), 'account_deletion_pending', 403);
    const existing = await this.store.get(markerPath);
    if (existing) assert(existing.owner_hash === who.hash && existing.product_id === body.product_id, 'purchase_already_claimed', 409);
    assert(!existing?.reversed && !await this.store.get('voidedPurchaseMarkers/' + tokenHash), 'purchase_revoked', 409);
    const purchase = await this.play.verifyPurchase(body.product_id, body.purchase_token);
    assert(purchase.productId === body.product_id && purchase.quantity === 1, 'invalid_purchase_quantity');
    assert(purchase.obfuscatedAccountId === who.hash, 'purchase_account_mismatch', 403);
    if (purchase.state === 'PENDING') return { state: 'PENDING', granted: false, ...(await this.profile(uid)) };
    assert(purchase.state === 'PURCHASED', 'purchase_not_completed', 409);
    const sealed = await sealReceipt(body.purchase_token, this.env), now = this.now();
    const opPath = who.base + '/operations/' + await sha256(body.request_id);
    const fingerprint = await sha256('purchase\n' + canonical(body));
    const result = await this.store.transaction(async tx => {
      assert(!await tx.get(who.tombstone), 'account_deletion_pending', 403);
      const profile = normalize(await tx.get(who.base) || newProfile(now), now), previous = await tx.get(markerPath);
      assert(!previous?.reversed && !await tx.get('voidedPurchaseMarkers/' + tokenHash), 'purchase_revoked', 409);
      const operation = await tx.get(opPath);
      if (operation) assert(operation.fingerprint === fingerprint, 'request_id_reused', 409);
      if (previous) { assert(previous.owner_hash === who.hash && previous.product_id === body.product_id, 'purchase_already_claimed', 409); tx.set(opPath, { fingerprint, created_at: now, result: { state: 'PURCHASED', token_hash: tokenHash } }); return { state: 'PURCHASED', granted: false, already_granted: true, profile: publicProfile(profile, who.hash, now) }; }
      assert(!purchase.consumed, 'unknown_consumed_purchase', 409);
      credit(profile, 'diamonds', PRODUCTS[body.product_id]);
      tx.set(who.base, { ...profile, updated_at: now });
      tx.set(markerPath, { owner_hash: who.hash, product_id: body.product_id, grant: PRODUCTS[body.product_id], granted_at: now });
      tx.set(jobPath, { owner_hash: who.hash, product_id: body.product_id, sealed_token: sealed, status: 'pending', created_at: now, attempts: 0 });
      tx.set(opPath, { fingerprint, created_at: now, result: { state: 'PURCHASED', token_hash: tokenHash } });
      return { state: 'PURCHASED', granted: true, already_granted: false, profile: publicProfile(profile, who.hash, now) };
    });
    result.consumption_pending = !await this.consume(tokenHash);
    return result;
  }
  async consume(hash) {
    const path = 'consumeJobs/' + hash, job = await this.store.get(path);
    if (!job || job.status === 'done') return true;
    try {
      await this.play.consumePurchase(job.product_id, await openReceipt(job.sealed_token, this.env));
      await this.store.transaction(async tx => { const current = await tx.get(path); if (current) tx.delete(path); });
      return true;
    } catch {
      await this.store.transaction(async tx => { const current = await tx.get(path); if (current) tx.set(path, { ...current, attempts: (current.attempts || 0) + 1, last_attempt_at: this.now() }); });
      return false;
    }
  }
  /** Only Google Play's authenticated voided-purchases feed calls this method. */
  async reverseVoidedPurchase(purchase) {
    assert(purchase && typeof purchase.purchaseToken === 'string' && purchase.purchaseToken.length > 0 && purchase.purchaseToken.length <= 4096, 'invalid_voided_purchase', 503);
    const hash = await sha256(purchase.purchaseToken), markerPath = 'purchaseMarkers/' + hash;
    const voidPath = 'voidedPurchaseMarkers/' + hash, now = this.now();
    const voidedAt = purchase.voidedTimeMillis === undefined ? null : Number(purchase.voidedTimeMillis);
    assert(voidedAt === null || Number.isSafeInteger(voidedAt) && voidedAt >= 0, 'invalid_voided_purchase', 503);
    return this.store.transaction(async tx => {
      const marker = await tx.get(markerPath), previousVoid = await tx.get(voidPath);
      if (!previousVoid) tx.set(voidPath, { revoked_at: now, voided_at: voidedAt });
      // Hash-only revocation records also stop a verification that fetched a
      // PURCHASED result just before Google reported the refund.
      if (!marker || marker.reversed) return { reversed: false, known: !!marker };
      assert(/^[a-f0-9]{64}$/.test(marker.owner_hash) && Number.isSafeInteger(marker.grant) && marker.grant > 0, 'invalid_purchase_marker', 503);
      const profilePath = 'players/' + marker.owner_hash;
      const tombstone = await tx.get('deletions/' + marker.owner_hash), profile = await tx.get(profilePath);
      if (!tombstone && profile) {
        const debt = profile.diamond_debt ?? 0;
        assert(Number.isSafeInteger(profile.diamonds) && profile.diamonds >= 0 && Number.isSafeInteger(debt) && debt >= 0, 'invalid_balance', 503);
        const deducted = Math.min(profile.diamonds, marker.grant), shortfall = marker.grant - deducted;
        assert(Number.isSafeInteger(debt + shortfall), 'balance_limit', 503);
        tx.set(profilePath, { ...profile, diamonds: profile.diamonds - deducted, diamond_debt: debt + shortfall, updated_at: now });
      }
      tx.set(markerPath, { ...marker, reversed: true, reversed_at: now, voided_at: voidedAt });
      tx.delete('consumeJobs/' + hash);
      return { reversed: true, known: true };
    });
  }
  async reconcileVoidedPurchases() {
    let cursor = await this.store.get(VOIDED_CURSOR);
    const now = this.now(), earliest = Math.max(0, now - VOIDED_LOOKBACK);
    const resuming = cursor?.next_page_token && cursor.window_start >= earliest && cursor.window_end <= now;
    // Leave a day of headroom on the initial backfill so a large paginated
    // result can resume at the next cron without crossing Google's 30-day cap.
    const start = resuming ? cursor.window_start : cursor?.completed_through == null
      ? Math.min(now, earliest + VOIDED_OVERLAP)
      : Math.max(earliest, cursor.completed_through - VOIDED_OVERLAP);
    const end = resuming ? cursor.window_end : now;
    let token = resuming ? cursor.next_page_token : '', reversed = 0, pages = 0;
    for (; pages < VOIDED_MAX_PAGES; pages++) {
      const page = await this.play.listVoidedPurchases(start, token, end);
      assert(page && typeof page === 'object' && !Array.isArray(page) && (page.voidedPurchases === undefined || Array.isArray(page.voidedPurchases)), 'invalid_voided_response', 503);
      const nextToken = page.tokenPagination?.nextPageToken ?? '';
      assert(typeof nextToken === 'string' && nextToken.length <= 4096 && (!nextToken || nextToken !== token), 'invalid_voided_response', 503);
      for (const purchase of page.voidedPurchases || []) if ((await this.reverseVoidedPurchase(purchase)).reversed) reversed++;
      const next = nextToken
        ? { completed_through: cursor?.completed_through ?? null, window_start: start, window_end: end, next_page_token: nextToken }
        : { completed_through: end, window_start: start, window_end: end, next_page_token: '' };
      const saved = await this.store.transaction(async tx => {
        const current = await tx.get(VOIDED_CURSOR);
        // Overlapping cron invocations can replay pages, but cannot regress the
        // checkpoint or overwrite another invocation's pagination progress.
        if (canonical(current) !== canonical(cursor)) return false;
        tx.set(VOIDED_CURSOR, next); return true;
      });
      if (!saved) return { status: 'concurrent_retry', pages: pages + 1, reversed };
      cursor = next; token = nextToken;
      if (!token) return { status: 'complete', pages: pages + 1, reversed };
    }
    return { status: 'continuing', pages, reversed };
  }
  async deleteAccount(uid, claims) {
    const now = this.now();
    assert(Number.isSafeInteger(claims.auth_time) && claims.auth_time * 1000 >= now - 300000 && claims.auth_time * 1000 <= now + 60000, 'recent_login_required', 401);
    const uidBytes = new TextEncoder().encode(uid);
    const encodedUid = Array.from(uidBytes, value => value.toString(16).padStart(2, '0')).join('');
    const who = await this.identity(uid), sealedUid = await sealReceipt(encodedUid, this.env);
    await this.store.transaction(async tx => {
      const previous = await tx.get(who.tombstone);
      if (!previous) tx.set(who.tombstone, { status: 'pending', sealed_uid: sealedUid, requested_at: now, attempts: 0 });
    });
    return this.finishDeletion(who.hash);
  }
  async finishDeletion(hash) {
    const path = 'deletions/' + hash, job = await this.store.get(path);
    if (!job) return { status: 'not_requested', deleted: false };
    if (job.status === 'deleted') return { status: 'deleted', deleted: true };
    try {
      // Tombstone exists before either purge or Auth deletion. All normal routes
      // re-read it in their transaction, including retries of old operations.
      await this.store.deleteTree('players/' + hash);
      // Remove encrypted receipts and any per-player processing indices. The
      // global purchase/SSV hash markers contain no raw UID, token or ad payload.
      for (;;) {
        const jobs = await this.store.query('consumeJobs', 'owner_hash', hash, 100);
        if (!jobs.length) break;
        for (const entry of jobs) {
          // A deletion stays pending until outstanding purchases are finalized;
          // their encrypted retry material is removed by consume on success.
          assert(await this.consume(entry.path.split('/').at(-1)), 'purchase_finalization_pending', 503);
        }
      }
      const encodedUid = await openReceipt(job.sealed_uid, this.env);
      assert(/^(?:[a-f0-9]{2}){1,512}$/.test(encodedUid), 'deletion_identity_unavailable', 503);
      const uid = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(encodedUid.match(/../g), value => parseInt(value, 16)));
      assert(await sha256(uid) === hash, 'deletion_identity_unavailable', 503);
      await this.play.deleteFirebaseUser(uid);
      await this.store.transaction(async tx => { const current = await tx.get(path); if (current) tx.set(path, { status: 'deleted', requested_at: current.requested_at, completed_at: this.now() }); });
      return { status: 'deleted', deleted: true };
    } catch {
      await this.store.transaction(async tx => { const current = await tx.get(path); if (current && current.status !== 'deleted') tx.set(path, { ...current, attempts: (current.attempts || 0) + 1, last_attempt_at: this.now() }); });
      return { status: 'deletion_pending', deleted: false, retryable: true };
    }
  }
  async scheduled() {
    let refunds;
    try { refunds = await this.reconcileVoidedPurchases(); }
    catch { refunds = { status: 'retryable_error' }; }
    const consume = await this.store.query('consumeJobs', 'status', 'pending', 100);
    for (const entry of consume) await this.consume(entry.path.split('/').at(-1));
    const deletions = await this.store.query('deletions', 'status', 'pending', 100);
    for (const entry of deletions) await this.finishDeletion(entry.path.split('/').at(-1));
    return { refunds, consume_attempted: consume.length, deletion_attempted: deletions.length };
  }
}

# Subway Runner Cloudflare Worker

This is source for `subway-runner-api`, with target URL
`https://subway-runner-api.abirahomod12113.workers.dev`. It has not been deployed
or verified with live Firebase, Google Play or AdMob in this workspace. Offline
cryptographic and transaction tests do not establish that owner accounts, IAM,
products, SSV delivery or the target hostname are operational.

The production entry point always uses Firestore `(default)` in Firebase project
`subway-runner-513217`, real Firebase RSA ID-token verification, real Google Play
Developer API verification for `com.subwayrunner.bd`, and Google's ECDSA verifier
keys for AdMob SSV. There is no environment switch to grant test purchases or
client-earned ad callbacks. The test files inject explicit local adapters only.

## Owner deployment configuration

Use Node 24+ for `npm test`. Install the declared development tools with `npm
install` in this directory. `wrangler.jsonc` declares the Worker, final public
project/package IDs, both production rewarded units, and the five-minute cron.
The Worker hostname follows the Cloudflare account's configured workers.dev
subdomain; confirm this account owns `abirahomod12113` before deployment.

Enable the Firestore, Firebase Authentication/Identity Toolkit, and Google Play
Android Developer APIs. Provision Firestore `(default)`. Apply
[`firestore.rules`](./firestore.rules) as the project's Firebase client rules:
all direct client access is denied. Grant the Worker service account IAM access
to read/write/delete Firestore documents and transactions, and to delete Firebase
Authentication users. Separately grant that service account access to the final
app in Play Console sufficient to read and consume one-time products and read
voided purchases. Firebase
rules do not grant or restrict this server's IAM credentials.

Configure Firebase Play Games sign-in and Android signing fingerprints in the
owner consoles. Create these **consumable, quantity-one** Play products:

| Play product | Server diamond grant |
| --- | ---: |
| `diamonds_100` | 100 |
| `diamonds_500` | 500 |
| `diamonds_1200` | 1,200 |
| `diamonds_2500` | 2,500 |

The Android Billing flow must set its obfuscated account ID to the lowercase
SHA-256 hex digest of the authenticated Firebase UID. `/v1/profile` also returns
this value as `profile.obfuscated_account_id`. Display the localized prices from
Play Billing. Catalog base USD prices are configuration, not payment authority.

Add these **Worker secrets**, never public variables or committed credentials:

```sh
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
npx wrangler secret put LEDGER_ENCRYPTION_KEY
```

`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` is the service account's PKCS#8 PEM private
key; actual newlines and escaped `\n` are supported. `LEDGER_ENCRYPTION_KEY` is
base64/base64url encoding of 32 random bytes for AES-256-GCM, for example a value
generated locally with `openssl rand -base64 32`. Back up the encryption key in
an owner-controlled secret manager; losing it prevents pending purchase or
account-deletion jobs from completing. `.dev.vars.example` contains placeholders
for local development only; `.dev.vars` must remain ignored.

Configure each AdMob rewarded unit to deliver server-side verification to:

```
https://subway-runner-api.abirahomod12113.workers.dev/admob/ssv
```

Revive unit: `ca-app-pub-1379059201302335/6015873225`.
Spin unit: `ca-app-pub-1379059201302335/7963379715`.
The native SDK must set SSV `user_id` and `custom_data` to the exact values
returned by the intent route. The callback verifier authenticates the original
raw query with Google's keys before any intent or transaction lookup. Only the
specified unit, owner, unexpired intent and signed timestamp can grant. The SDK
`onUserEarnedReward` callback triggers polling; it never awards by itself. Test
ad units are rejected by the production ledger.

Once owner configuration is complete, deploy with `npm run deploy`. Keep the
cron enabled to reconcile voided purchases and retry consume and deletion work. Perform actual Play test-track
and AdMob SSV tests before distributing a release, including pending/canceled
purchases, connection loss, duplicate deliveries, same-token claims, consume
retry, refunds before/after spending, UTC rollover, expired intents, and Firebase Auth deletion failure. The
source tests make no live network requests.

## API

Protected routes require `Authorization: Bearer <Firebase ID token>`. Bodies are
JSON (maximum 32 KiB). Responses are JSON with `Cache-Control: no-store`.
Mutations require an 8–128 character `request_id` using letters, numbers, `_` or
`-`; UUIDs work. Reuse the same request ID and body after an ambiguous timeout.
Reusing an ID for a different operation/body is rejected. Apply returned profiles
as replacement snapshots rather than adding balances locally. Native Android
performs HTTPS requests; the browser bridge does not expose identity tokens.

| Method and path | Body / result |
| --- | --- |
| `GET /health` | Public process health; does not test external account access. |
| `GET /v1/catalog` | Public fixed products, items, styles, spin odds and UTC limits. |
| `GET /v1/profile` | `{profile}` including balances, owned styles, inventory, server UTC day/time and spin availability. |
| `PUT /v1/progress` | `{request_id,progress}`; allowlisted noncurrency fields only. |
| `POST /v1/runs/start` | `{request_id}` → `{run_id,profile}`; starts one active run and abandons the previous one. |
| `POST /v1/runs/finish` | `{request_id,run_id,score,distance,coins}` → once-only bounded normal-coin credit and profile. |
| `POST /v1/spins` | `{request_id,source:"free"\|"diamonds"}` → `{reward,profile}`. |
| `POST /v1/store` | `{request_id,kind,id,quantity?,run_id?}` → purchase/consume result and profile. |
| `POST /v1/rewards/intents` | `{request_id,placement:"revive"\|"spin",run_id?}` → opaque intent, SSV settings, expiry and profile. |
| `GET /v1/rewards/intents/{id}` | Owner-only intent state (`pending`, `granted`, `expired`), reward and profile. |
| `GET /admob/ssv` | Google-signed SSV callback only; no Firebase bearer token. |
| `POST /v1/purchases/verify` | `{request_id,product_id,purchase_token}` → verified state, grant flags, consume retry state and profile. |
| `POST /v1/account/delete` | `{request_id}`; Firebase `auth_time` must be within five minutes. |

Progress fields: `selected_style` (must be owned), `high_score`, `best_distance`,
`tutorial_seen`, and `settings:{music,sfx,quality}`. Scores/distances are bounded
integers; importing a noncurrency best score grants no currency or entitlement.
Store kinds are `style` (`character` alias), `item` (`magnet`/`shield`), `exchange`
(`coins_1000`), and `use_item`. Item consumption requires an active server run;
optional `run_id` must match it. Each item consumption costs exactly one item.

Spins allow one free spin and two ad spins per UTC day. Pending ad intents
reserve a slot for ten minutes, preventing a third watched ad from exceeding the
two-spin budget. Diamond spins cost 20 diamonds with no daily limit. Spin odds
are versioned public launch configuration in `catalog.js`; duplicate characters
pay 300 coins. A revive is bound to its one active run and can grant once per run.
A daily spin intent cannot be carried into a later UTC day.

Normal run rewards are bounded by elapsed server time and distance (maximum 500
coins/run), and require a run lasting 1–2,700 seconds. These bounds limit client
claims; they do not prove a device executed every game action or provide a
complete competitive anti-cheat system. The 99,999-coin guest preview balance is
never imported into this server economy.

Purchase state, quantity and UID binding come from Google, never the request.
Pending/canceled purchases cannot grant. Unknown already-consumed tokens are
rejected. An atomic Firestore transaction writes the profile grant, globally
unique token-hash ownership marker, request marker and encrypted consume outbox.
Consumption happens after commit and retries on repeat verification and cron.
No purchase-token plaintext is stored. The five-minute cron polls Google's
authenticated voided-purchases API with fixed start/end windows, a 24-hour
overlap and at most three pages per invocation. It persists unfinished page
tokens and advances the completed checkpoint only after all pages succeed.
The initial backfill covers 29 days, leaving a day to resume pagination within
Google's 30-day history limit. Keep cron running regularly; events outside that
API history cannot be recovered by this poller. RTDN is not implemented.

A trusted void atomically marks the receipt reversed, removes pending consume
work, and deducts the original diamond grant. If the diamonds were spent, the
shortfall becomes nonnegative `profile.diamond_debt`; subsequent diamond grants
repay it before increasing the spendable balance. Paid spins and store spending
are blocked with `purchase_debt_outstanding` while debt remains. Free/ad rewards,
run rewards and owned-item use continue. Replayed voids cannot deduct twice.
Hash-only revocation records also block stale verification of a refunded token
that had not yet been granted. Every refunded-token verification fails with
`purchase_revoked`, including retries of an earlier successful request.

Account deletion first writes a tombstone checked by all player transactions,
then recursively purges the profile and subcollections, finalizes/removes pending
receipt work, and deletes the Firebase Authentication user with the Admin API.
HTTP 200 with `{deleted:true,status:"deleted"}` is returned only after all cleanup
and Auth deletion succeed. A failure returns HTTP 202 with
`{deleted:false,status:"deletion_pending",retryable:true}`; the cron retries using
an encrypted UID. Once complete, the encrypted UID is erased. Only hashed
purchase/SSV ownership markers, hash-only revocation records and the deletion tombstone remain for duplicate
and fraud prevention; they contain no raw UID, receipt, email or ad payload.
A pending delete blocks further reads, sync, spends and grants. Refund processing
never recreates a missing or tombstoned player profile.

## Offline verification

```sh
npm test
```

Node's built-in tests cover locally signed Firebase/AdMob messages, signature
alteration, scoped service-account OAuth, AES receipt encryption, concurrent
free/diamond/ad limits, global once-only receipt/SSV grants, item spending,
run-bound revives, consume retries, refund/debt recovery, void-feed pagination
and tombstone/Auth-delete failure recovery.
Explicit in-memory adapters are test-only. No Google account, Cloudflare account,
private owner credential or paid transaction is exercised by these tests.

## Deploy the supplied deny-client rules

From this directory, with an owner-authenticated Firebase CLI, run:

```sh
firebase deploy --only firestore:rules --project subway-runner-513217
```

`firebase.json` points to the included `(default)` rules. This command was not run
here; existing deny-all rules are compatible with the server-only data access.

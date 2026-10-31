# Subway Runner purchase service

This is backend source and an offline-tested receipt ledger. **It is not deployed,
and no live purchase has been tested.** The game's requested 99,999-coin preview
mode must remain separate from this server: client-reported coins are never
accepted here. Production monetization requires real Play products, credentials,
HTTPS hosting, account configuration and end-to-end Play test-track validation.

## What it does

- Verifies receipts against the real Google Play Developer API for one fixed
  application ID. Purchased state grants; pending/parental approval never grants.
- Stores a durable SQLite ledger and encrypted receipts. Grants, wallet changes
  and retryable acknowledge/consume work are committed atomically. Repeated or
  concurrent receipt submissions do not mint more coins.
- Allows verified permanent-product restoration into another anonymous session.
  A restored starter pack restores its astronaut only: its 2,000 coins are granted
  once per receipt lifetime. Receipt tokens are sensitive bearer proof: transport
  only over HTTPS, never include them in logs, links or analytics.
- Restricts a consumable receipt to its original session. Already consumed receipts
  unknown to the ledger are rejected, rather than granting an unverifiable balance.
- Reconciles Google's voided-purchases feed, reverses coin grants once and revokes
  every permanent entitlement claim derived from a refunded receipt. Separate
  valid purchases of the same cosmetic continue to provide access.
- Provides fixed-price server-bank cosmetic unlocks. There is no endpoint accepting
  a client-supplied price, arbitrary coin credit, reward or entitlement.

## Catalog

| Product ID | Type | Grant |
| --- | --- | --- |
| `coin_pack_small` | Consumable | 1,000 purchased coins |
| `coin_pack_medium` | Consumable | 6,000 purchased coins |
| `coin_pack_large` | Consumable | 15,000 purchased coins |
| `starter_pack` | Nonconsumable | astronaut + 2,000 coins once |
| `character_astronaut` | Nonconsumable | astronaut |
| `character_neon` | Nonconsumable | neon |
| `remove_forced_ads` | Nonconsumable | remove forced ads |

Enable only quantity-one purchases in the native Billing flow; multi-quantity
receipts are rejected. Display localized prices fetched from Play, never a backend
hard-coded price. Current server-bank unlocks are `sprinter` (1,200) and `robot`
(3,500). Keep the client catalog synchronized with these IDs and values.

## API contract

All POST bodies require `Content-Type: application/json`; maximum body is 16 KiB.
Only the exact declared body fields are accepted. All responses are JSON and
`Cache-Control: no-store`. Purchase states come from Google, never from the app.

1. `POST /v1/session` with `{}` creates an anonymous installation session and returns
   `session_token`, `obfuscated_account_id` and `profile`. Store the session token
   in protected local storage; set Billing's obfuscated account ID to the provided
   account ID when starting new purchases. Existing first claims with a different
   Google account binding are rejected.
2. Use `Authorization: Bearer <session_token>` on every endpoint below.
3. `GET /v1/profile` returns `{"profile":{"wallet_coins":...,"wallet_debt":...,"entitlements":[...]}}`.
4. `POST /v1/purchases/verify` with `{"product_id":"...","purchase_token":"..."}`.
   `status` is `pending` or `granted`; errors use non-2xx status plus a stable `error`
   code. A grant may include `finalization_pending:true`: the durable work must be
   retried before Google's acknowledgement deadline. Do not grant again locally.
5. `POST /v1/store/unlock` with `{"style_id":"sprinter"}` or `robot` atomically debits
   the purchased-coin bank once, then returns the new profile. Retries do not charge
   again. Insufficient funds return `409 insufficient_paid_coins`.
6. `GET /health` returns only service status, not credentials or environment values.

Treat `wallet_coins` as a replacement balance, **never add it to the local wallet
on every refresh**. Gameplay-earned coins are a separate local balance. The server
does not validate runs or import local earned coins. A production client must use
the server spend endpoint for purchases funded by the server coin bank and reconcile
that bank and verified entitlements on reconnect. Offline progress is not a proof
of a paid purchase. Refunding already-spent coins creates debt; server-coin cosmetics
are suspended while debt remains and become available after repayment. This is
distinct from unrelated locally earned/free cosmetics.

## Recovery limitations

Anonymous sessions are not Google user accounts. Reinstalling without the original
session token cannot restore a spent/consumed coin wallet. Permanent products can
be restored using the native Billing query and online receipt verification, while
the ledger prevents the starter bonus from being minted twice. Full cross-device
coin-wallet recovery needs a proper signed-in account/recovery system. Do not
advertise it as implemented. Back up the database and encryption key together.
Losing either loses reliable receipt reconciliation. Keep them outside source ZIPs.

## Deployment (owner setup required)

1. Provision Python 3.12+, install `requirements.txt`, and use durable storage for
   the SQLite database. A single service replica is appropriate for this SQLite
   implementation; use a transactional shared database before scaling replicas.
2. Create the final app/products in the owner's Play Console. Grant a dedicated
   service account only the Play API access needed for purchase verification,
   acknowledgement and refunds/voided purchase review. Enable the API for its
   Google Cloud project. Do not send credentials in chat or commit them.
3. Set environment variables from `.env.example` using hosting secrets. Set
   `PLAY_PACKAGE_NAME` to the final actual application ID. Set either a service
   account credential file path in `GOOGLE_APPLICATION_CREDENTIALS` or an externally
   refreshed short-lived `GOOGLE_PLAY_ACCESS_TOKEN`. Workload identity should refresh
   the latter; this server does not refresh an injected expired access token.
4. Generate a Fernet key with the cryptography package and store it as
   `PURCHASE_TOKEN_ENCRYPTION_KEY` in the hosting secret manager. Preserve it with
   encrypted backups. The service refuses to start without an encryption key and
   Play API authentication. `.env.example` is a template; it is not automatically loaded.
5. Run `python3 server.py` behind an HTTPS reverse proxy. Default bind is loopback
   only. This stdlib HTTP entry point needs a trusted edge with TLS, strict request
   limits, timeouts and per-IP/session rate limiting, especially session creation.
   Do not expose its plain HTTP port publicly. Redact Authorization, receipts and
   response bodies in proxy logs; allowlist the game's origins if needed.
6. Schedule `python3 server.py --reconcile` **frequently** (for example every 15
   minutes) using the same secrets/database. Alert on failures and outstanding
   finalization work; acknowledgement must complete within Google's deadline.
   Keep voided-purchase reconciliation running, including after launch, because
   Google's history is limited. RTDN integration is not included; polling is used.
7. Wire the deployed HTTPS URL into the game only after successful health and
   protected endpoint checks. Use Play license testers and test-track installs
   for purchase, parental approval, cancel, pending, interrupted network,
   duplicate retry, consume/ack, reinstall restore and refund tests. Local fake
   adapter tests are useful but do not establish Play integration works live.
8. Provide truthful Data Safety/privacy disclosures covering identifiers, purchase
   history, storage/retention and support/deletion handling. No birth date, player
   name, email or ad identifier is accepted by these endpoints. Make retention
   and deletion operations fit the deployed business/legal requirements.

No deployment credentials, Google service account or hosting account are included.
No ad monetization is implemented by this backend. No owner account has been
contacted or changed.

## Offline verification

Run from this directory:

```sh
python3 -m unittest -v test_server.py
```

Tests use a fake Google adapter and temporary SQLite databases. They cover purchase
states, exactly-once/concurrent grants, account binding, encrypted receipt storage,
permanent restoration, starter bonus nonduplication, cross-session consumable
rejection, finalization retry, refund revocation, paid-bank spend/debt and request
validation. No Google requests or real money are involved.

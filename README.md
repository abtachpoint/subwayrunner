# Subway Runner — consolidated Android project

This update preserves the existing delivered **WebGL/WebView game**. The course,
renderer and original city/character geometry remain byte-for-byte unchanged.
The active build is the standard Android `:app` module. Earlier `game/` Godot
sources and `android/services/` are retained legacy development work, excluded
from the active Android application.

## Signed AAB with Codemagic

Start with **[docs/CODEMAGIC.md](docs/CODEMAGIC.md)**. The repository-root
`codemagic.yaml` is prepared for the actual Android `:app` module, managed owner
upload signing, JDK17, SDK36/Build Tools36.0.0 and checksum-verified Gradle8.14.3.
The owner-verified Play Games app_id **613238310945** is already configured in
`android/gradle.properties`, generated as `play_games_app_id`, and referenced by
the Android manifest. It is distinct from the full OAuth client IDs.

No GitHub remote or Codemagic account connection is available in this workspace.
Use `release/Subway-Runner-Codemagic-ready.zip`: its files are at ZIP/repository
root, including `codemagic.yaml`. Extract and upload the contents to GitHub,
connect that repository in Codemagic, and register the existing authorized upload
keystore with reference `subway_runner_upload`. Then run `android-internal`.

The workflow installs tool dependencies, tests the project, runs real Gradle
Android tasks, and requires cryptographic signature verification of every AAB
payload. Its artifact is `release/Subway-Runner-internal.aab` with checksum and
signer metadata. Version codes increment automatically from Codemagic counters.
No substitute key is created and no unsigned AAB is accepted by this workflow.

**The workflow has not been run on a connected Codemagic account here.** Android
compilation and actual output remain for the first remote build; no AAB has been
fabricated or claimed. This local workspace still lacks SDK/Gradle. Local source,
CI wiring, signed-fixture verification and game/Worker tests have passed.

Cloudflare secrets, reachable APIs and activated IAP products are deliberately
not prerequisites for AAB generation. The signed release already includes the
owner's real endpoint, ad-unit IDs and product IDs. Console/backend activation
can follow the first upload without rebuilding while those compiled identities
remain unchanged. Debug uses Google sample ads; register internal release test
devices in AdMob before testing the installed release.

## Implemented source

- Final application `com.subwayrunner.bd`; supplied Firebase configuration is in
  `android/app/google-services.json` and matches the supplied project/app IDs.
- Native Play Games v2 server-authorization-code exchange with Firebase Auth;
  manual sign-in/status in menu/settings, guest/offline gameplay and cloud sync.
  The actual Games `app_id` is configured explicitly, never guessed from Cloud.
- Exact-origin, main-frame-only WebMessage bridge over HTTPS local assets.
  Firebase identity tokens and purchase receipts remain in the Android host.
- Rewarded ads only, explicit player actions, adult age/UMP consent gate, Google
  sample inventory in debug and owner units in the Codemagic release. No automatic ads, banners, interstitials or app-open
  ads are implemented in the active application. SDK-earned callbacks never grant.
- Four consumable Diamond products: diamonds_100, diamonds_500, diamonds_1200,
  diamonds_2500. Prices come from Play, never a fake local purchase confirmation.
  Native pending purchase reconciliation submits to the real verification API.
- Worker/Firebase-token validation, Firestore transactions, encrypted receipt
  outbox, account-bound once-only grants and Google consumption after commit.
- Server UTC daily economy: one free spin, at most two ad spins, unlimited extra
  spins at exactly 20 Diamonds while funds suffice; at most one ad revive per run.
  Signed AdMob SSV must match a server-issued intent, player, unit and live run.
- Refund/void polling, atomic reversal/debt and duplicate protection; account
  deletion tombstones, data cleanup, recent reauthentication and retryable jobs.
- Existing runners, normal coin shop, inventory, controls, animations and audio
  retained; no 99,999 test balance is imported into a paid production account.
- Privacy, consent and deletion UI access. Public policy/deletion replacement
  sources are in `public-info/`; they have NOT been deployed to the supplied URLs.

The old shipped game had no real spin-outcome table. The versioned initial odds
and duplicate-character compensation are explicit editable configuration in
`worker/catalog.js`, displayed before paid spins, not an invented claim that a
previous owner-supplied table existed. Review those economy values before launch.

## Verify locally

Use Node24+ and Python3:

```sh
node --test --test-isolation=none tests/*.test.cjs
cd worker
npm test
cd ..
python3 tools/preflight_android.py --source-only
bash tools/build_android.sh
```

JS tests execute the actual controller/simulation with DOM/native adapters.
Worker tests use real local RSA/ECDSA signatures and test-only Google/storage
adapters. None proves Android SDK compilation, live Google authentication, ads,
Play transactions, Cloudflare deployment or actual deletion of a production user.

## Build and deployment

The primary workflow is [codemagic.yaml](codemagic.yaml); follow
[docs/CODEMAGIC.md](docs/CODEMAGIC.md) for exact upload-key and manual Play upload
steps. `tools/build_android.sh --require-signing --ads-mode live` is the real
signed bundle build. There are no backend reachability or product-activation
checks that block compilation. See `android/README.md` for the native host.

`worker/README.md` gives exact private Cloudflare secrets, Google IAM permissions,
Firestore rules, deployment commands, SSV URLs and live acceptance checks. The
worker code is deployment-ready source, not an operational deployment. No owner
service-account key or Cloudflare token was supplied, read or fabricated.

No production SDK/identity/reward/purchase success is simulated by the app. When
services are unavailable, the game remains playable locally as a guest and online
transactions report pending/unavailable states. Actual Google/Codemagic/Play and
Cloudflare tests remain necessary after remote compilation and configuration.

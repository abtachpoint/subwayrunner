# Subway Runner Android app

The active Gradle module is `:app`, package `com.subwayrunner.bd`. It packages
`../web` as local assets and runs the game with `WebViewAssetLoader` at
`https://appassets.androidplatform.net/assets/index.html`. The earlier Godot
`:services` sources and export helpers are preserved for reference and are not
included in this application's build.

The toolchain pins AGP 8.10.1, Kotlin 2.2.21, Google Services plugin 4.5.0,
AndroidX WebKit 1.18.0, Firebase BoM 35.1.0, Play Games v2 22.1.0,
Play Billing 9.1.0, Google Mobile Ads 25.5.0 and UMP 4.0.0. Use JDK 17,
Gradle 8.14.3 and Android SDK platform 36 (Build Tools36.0.0 are explicitly pinned). Minimum Android version is API 24;
target and compile SDK are API 36.

## Build and signing

Run the real SDK build from the repository root:

```sh
bash tools/build_android.sh
```

Set `ANDROID_HOME` and install Gradle, or set `GRADLE_EXECUTABLE` to a supported
Gradle executable. No fabricated APK/AAB or local test signing key is used by
this pipeline. Without the owner's upload signing environment variables, its
release AAB is unsigned and cannot be uploaded to Google Play:

```text
ANDROID_KEYSTORE_PATH
ANDROID_KEYSTORE_PASSWORD
ANDROID_KEY_ALIAS
ANDROID_KEY_PASSWORD
```

The owner verified Play Games **game/app ID613238310945** from the Configuration
page. `android/gradle.properties` stores it; `resValue` generates the
`play_games_app_id` resource used by the manifest. This confirmation, rather than
an assumption about the Cloud project number, is the source of that value.
Firebase configuration is in `app/google-services.json`; the server OAuth client
ID is an explicit BuildConfig field because the supplied file has no OAuth-client
arrays. Production validation requires the actual Games app ID, owner upload
signing and explicit live ads:

```sh
bash tools/build_android.sh --production
```

The ordinary local default uses Google's official sample rewarded unit
`ca-app-pub-3940256099942544/5224354917` and sample application ID
`ca-app-pub-3940256099942544~3347511713`. Debug variants always use these samples,
even if a live-ads property was supplied. Live release builds use application ID
`ca-app-pub-1379059201302335~7903669960`, revive unit
`ca-app-pub-1379059201302335/6015873225` and spin unit
`ca-app-pub-1379059201302335/7963379715`. Sample ads do not prove production
server-side verification or award real currency; a reward remains pending until
the backend verifies an actual authorized SSV callback.

## Native bridge

`WebViewCompat.addWebMessageListener("SubwayNative", ...)` accepts the exact
asset origin only and rejects subframe messages. Requests are JSON objects
`{id,method,params}`. Replies are `{id,ok,result}` or `{id,ok:false,error}`.
There is no `addJavascriptInterface` fallback. A provider without the secure
WebMessage feature keeps offline guest play available.

The method allowlist is `set_age`, `auth_status`, `sign_in`, `sign_out`,
`profile`, `catalog`, `progress_save`, `run_start`, `run_finish`, `spin`, `store`,
`products`, `purchase`, `reward`, `reward_refresh`, `privacy_options`,
`open_privacy`, `open_deletion` and `delete_account`. Each service method maps
to a fixed native HTTPS endpoint; JavaScript cannot supply an HTTP URL or token.
Firebase identity tokens, Games server codes and Play purchase tokens remain
native. Unsolicited events are `CustomEvent('subway-native')` with
`detail:{type,payload}`. The game pauses on `ad_state`/`lifecycle` events and
requires an explicit user action to resume gameplay.

The WebView disables file/content access, mixed content, arbitrary navigation,
popups, cookies, geolocation and permission grants. Requests outside packaged
assets are blocked. Only the two fixed public privacy/account-deletion URLs can
open an external browser through dedicated native methods.

## Identity, purchases and rewards

Native Play Games v2 requests a server authorization code and exchanges it with
Firebase Auth using `PlayGamesAuthProvider`. Deletion requests first repeat the
Games authorization, call `FirebaseUser.reauthenticate`, force a fresh native
identity token and POST `/v1/account/delete`. The backend validates actual JWT
`auth_time`; a JavaScript freshness assertion is never accepted. Native Firebase
sign-out occurs only after a verified `deleted` server response.

Diamond products are the four fixed IDs `diamonds_100`, `diamonds_500`,
`diamonds_1200` and `diamonds_2500`. Prices come from Play `ProductDetails`.
The native host sets the server-verified obfuscated account binding, saves
purchased tokens privately, reconciles outstanding purchases on resume/sign-in
and sends tokens directly to `/v1/purchases/verify`. Neither the SDK purchase
callback nor the browser grants or consumes Diamonds. The backend verifies,
grants idempotently and completes consumable finalization.

Ads are optional, explicit-action rewarded ads only, with placements `revive`
and `spin`. There are no banners, interstitials or app-open ads. Under-13, teen
and unknown selections do not initiate UMP, Mobile Ads initialization or ad
requests. After an adult action, UMP refreshes consent and presents any required
form; only `canRequestAds()` permits Mobile Ads initialization and loading.
Ad requests use maximum content rating G and `npa=1`.

The host creates an authenticated `/v1/rewards/intents` record, sets SSV's
Firebase user ID and opaque intent custom data before showing, and polls
`GET /v1/rewards/intents/{id}` after dismissal. An SDK earned callback never
grants a reward. The backend enforces one ad revive per run and two ad spins per
day. Pending intent identifiers and idempotency keys are saved natively; retries
check verification instead of showing another ad for the same pending action.
Late SSV can refresh the profile after resume; unavailable/skipped/pending ads
give no invented reward. UMP privacy options are accessible from Settings when
required. Age changes invalidate outstanding ad callbacks and stop new requests;
an SDK already initialized for an adult cannot be unloaded in the same process.

The manifest removes the ads initialization provider and advertising-ID,
AdServices ID/attribution/topics permissions. Inspect the actual merged manifest
and test this policy on a device; source inspection is not runtime evidence.

## Verification limits

The current workspace has no Android SDK, Gradle or adb, and dependency access is
not available. These native changes have been reviewed as source, not compiled
or device-tested. Run lint/build with the real SDK, inspect the merged manifest
and test on a Play-distributed internal build before production. Play Games,
Firebase provider/OAuth SHA certificates, Billing products/license testers, UMP
messages, AdMob SSV URLs and owner upload signing need their matching Console
configuration. None of those remote configurations are created by these files.

## Codemagic signed internal bundle

Use the root `codemagic.yaml` and [Codemagic instructions](../docs/CODEMAGIC.md).
That workflow uses `--require-signing --ads-mode live`, the existing managed
upload key, automatic version codes, and real owner service IDs in the release.
It does not require a deployed backend or active products to build. Debug always
uses sample units. All release payloads must pass JDK signature verification.

# Android / Codemagic source audit

Audit date: 2026-10-31. **Source and official API documentation were reviewed;
the Android app was not compiled in this workspace.** There is no installed
Gradle executable, Android SDK platform/build tools, `sdkmanager` or Kotlin
compiler here. No replacement SDK, stub compilation or fabricated bundle was
used. A successful Codemagic Gradle build is still required to establish that
the complete resolved dependency graph compiles and packages.

## Verified source configuration

| Area | Finding |
| --- | --- |
| Application | Active module is `:app`; namespace and application ID are `com.subwayrunner.bd`. The archived `:services`/Godot module is excluded by `settings.gradle.kts`. |
| Packaged game | `android/app` uses `../../web` as its assets directory, which resolves to the existing repository `web/`. The host loads `/assets/index.html` with `WebViewAssetLoader`. |
| Android levels | `compileSdk` and `targetSdk` are 36; `minSdk` is 24. |
| Toolchain | AGP 8.10.1, Kotlin 2.2.21, Java/JVM target 17. CI Gradle 8.14.3 is in the compatible Gradle 8.14 line. |
| Firebase | Google Services plugin is applied to the application module. Its JSON is in `android/app/google-services.json`, with exactly one client for the application package, project `subway-runner-513217`, project number `613238310945`, and app ID `1:613238310945:android:a6a750a7838becef4bbb60`. Public app configuration is not an upload signing key. |
| Identity | The native host calls Play Games v2 and exchanges its server authorization code with Firebase. The explicit server client ID avoids relying on absent OAuth arrays in the supplied Firebase JSON. Tokens stay outside the JavaScript bridge. |
| Billing | Four Diamond product IDs are fixed. Play prices are returned from product queries. The backend, rather than purchase callbacks, verifies and grants purchases; the client does not consume them. |
| Ads | Debug always uses official Google test IDs. Internal release defaults to test IDs; live release requires explicit mode selection. Unknown/under-13/teen age groups do not start UMP or load ads. Reward callbacks do not grant currency; the backend must verify SSV. |
| Release | Release is non-debuggable and not minified. A configured owner upload signing identity is applied to release; absent signing can otherwise produce an unsigned release bundle. |
| Expected Gradle output | `android/app/build/outputs/bundle/release/app-release.aab`, copied by the build script into `release/`. These are expected paths, not proof that an AAB currently exists. |

## Current API signatures checked

No definite native Kotlin SDK signature mismatch was found in the inspected
source. This is a source review, not a compiler result.

* Billing 9.1.0 is a released version. `queryProductDetailsAsync` now provides
  `QueryProductDetailsResult`; this implementation correctly reads
  `response.productDetailsList`. The builder accepts `PendingPurchasesParams`
  and supports `enableAutoServiceReconnection()`. One-time product offers and
  `ProductDetailsParams.Builder.setOfferToken` remain supported. See the
  [Billing release notes](https://developer.android.com/google/play/billing/release-notes),
  [query-result API](https://developer.android.com/reference/com/android/billingclient/api/QueryProductDetailsResult),
  [billing-client builder](https://developer.android.com/reference/com/android/billingclient/api/BillingClient.Builder),
  [ProductDetails](https://developer.android.com/reference/com/android/billingclient/api/ProductDetails)
  and [purchase-parameter builder](https://developer.android.com/reference/com/android/billingclient/api/BillingFlowParams.ProductDetailsParams.Builder).
* `GamesSignInClient.signIn()` provides `Task<AuthenticationResult>`; its
  two-argument `requestServerSideAccess(String, boolean)` still provides
  `Task<String>`. The newer three-argument scopes overload returns
  `Task<AuthResponse>` and is not the overload used here. See
  [GamesSignInClient](https://developers.google.com/android/reference/com/google/android/gms/games/GamesSignInClient).
* `PlayGamesAuthProvider.getCredential(String)` remains the Firebase
  credential entry point. Firebase BoM 35.1.0 maps Auth to 25.0.0, whose
  minimum SDK increased to API 24; the application already uses 24. See
  [Firebase release notes](https://firebase.google.com/support/release-notes/android)
  and [PlayGamesAuthProvider](https://firebase.google.com/docs/reference/android/com/google/firebase/auth/PlayGamesAuthProvider).
* AndroidX WebKit 1.18.0 is the official October 21, 2026 stable release.
  Its minimum-SDK increase to 24 was already satisfied. The inspected host
  uses the existing asset-loader and web-message-listener APIs. See
  [WebKit release notes](https://developer.android.com/jetpack/androidx/releases/webkit)
  and [WebMessageListener](https://developer.android.com/reference/androidx/webkit/WebViewCompat.WebMessageListener).
* The ad source uses the supported rewarded-ad loading, full-screen callback,
  SSV-options and earned-reward callback APIs. No server reward is inferred
  from the earned callback. See
  [RewardedAd](https://developers.google.com/admob/android/reference/com/google/android/gms/ads/rewarded/RewardedAd).

AGP 8.10 supports API 36, needs JDK 17 and Gradle at least 8.11.1, and defaults
to Build Tools 35.0.0. Kotlin 2.2.21 lists Gradle through the 8.14 line and AGP
through 8.11.1 as fully supported. See
[AGP compatibility](https://developer.android.com/build/releases/agp-8-10-0-release-notes)
and [Kotlin Gradle compatibility](https://kotlinlang.org/docs/gradle-configure-project.html).

## Findings for the CI implementation

1. Install both Build Tools 35.0.0 and 36.0.0, or explicitly pin
   `buildToolsVersion` to an installed supported version. The original build
   preflight required 36.0.0 while AGP's unpinned default is 35.0.0. Installing
   only 36.0.0 can leave Gradle attempting an additional SDK download.
2. Require all four owner signing fields together, an existing absolute private
   keystore path, and a private-key alias. A relative path was interpreted from
   the repository by preflight but from `android/app` by Gradle; `~` was also
   expanded only by preflight. Codemagic's injected absolute path avoids this
   disagreement.
3. A successful `jarsigner -verify` process alone is insufficient evidence that
   an AAB is signed: unsigned JARs can return success. Check that the built AAB
   actually has a signer, record the signing certificate fingerprint, and compare
   it with the configured keystore certificate. Play Console still determines
   whether that certificate is an authorized upload key.
4. Preserve both Gradle outputs and failure reports as Codemagic artifacts.
   Build from `android/` using the `:app:` tasks; do not invoke the archived
   Godot build or the local prototype APK builder.
5. Keep internal test ads separate from production. A signed internal AAB does
   not require enabling live ad traffic. Production flag checks establish
   supplied configuration, not deployed backend or Console readiness.

## What this audit does not establish

Only a real SDK build establishes dependency resolution, Kotlin/Java compilation,
merged-manifest validity, DEX/resource packaging and the actual AAB contents.
`testDebugUnitTest` may report `NO-SOURCE` where there are no native unit tests;
JavaScript and Worker tests do not exercise an Android device.

The generated bundle still needs inspection and a Play internal-track device
test. Check the upload certificate, Play app-signing SHA certificates and OAuth
bindings, PGS configuration/testers, Firebase Games provider, Billing products
and license testers, backend deployment/Google permissions, UMP messages,
AdMob callback configuration and actual signed SSV delivery. Source flags do not
establish any of those external states. No fake PGS ID or signing identity is
needed to complete the source build workflow.

## Implemented CI findings

The app now pins Build Tools36.0.0, matching setup/preflight. Both managed key
setup and Gradle signed validation require absolute readable paths. The signed
workflow invokes VerifyBundle.java via verify_aab.py to authenticate every
payload, rejecting unsigned/mixed/tampered archives rather than relying on
jarsigner's exit code. Signer SHA256 is recorded; optional
EXPECTED_UPLOAD_CERT_SHA256 compares a known upload fingerprint. Play still
determines key authorization. The original game payload is unchanged. Codemagic
release selects owner ad IDs so later console activation does not need a rebuild;
debug remains sample-only and internal release testers must be AdMob test devices.

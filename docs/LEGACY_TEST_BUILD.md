# Subway Runner — native Android rebuild

An original, portrait 3D endless runner built with Godot 4.6.3. This replaces the
earlier WebView prototype. Its original sunny city theme is retained, with native
articulated characters, independent oncoming trains and mobile rendering batches.

## Actual delivery status

**An installable Android test package is now built:**
`release/Subway-Runner-test.apk` (about 2.1 MB). This offline test APK uses a
WebView/WebGL renderer with the original Godot-exported city and articulated
character geometry. It is separate from the uncompiled native Godot release.

The APK has a real binary Android manifest, real DEX launcher, preserved signing
identity and v1/v2 signatures. Independent OpenSSL, JDK streaming/JAR and APK
signature/manifest/DEX checks pass. Actual WebGL shaders and geometry have been
rendered via local surfaceless GLES replay. These are local verification steps;
**phone installation, Android WebView behavior and phone FPS remain unverified**.

The test APK has no Internet permission, advertiser SDK or real billing. Its
clearly labelled adult-only demo-ad screen tests the revive interaction locally;
it is not an AdMob advertisement. Permanent paid characters are previewable, and
real payments are disabled. It uses a generic Android launcher icon.

The native Godot project and Kotlin Billing/AdMob sources are preserved. Native
APK/AAB compilation remains blocked by absent SDK/Gradle/export templates and
network approval that never completed. The current local APK does not claim that
those native SDK sources compiled or that live monetization is implemented.

To reproduce the local test package without downloads:

```sh
node tests/web_simulation.test.cjs
node tests/web_ui.test.cjs
python3 tools/build_local_apk.py
python3 tools/check_local_apk.py
```

`tools/check_local_apk.py` independently audits signatures, binary manifest, DEX
and asset completeness. Do not use `--allow-incomplete` for a delivered build.
Preserve `.signing/LOCAL-TEST-key.pem` securely for future local test updates; it is
intentionally excluded from APKs/source archives. A production signing setup
needs separate owner-controlled keys and acceptance checks.

## Requested test configuration

- Name: **Subway Runner**; original, colorful metro-city environment.
- A fresh **test-only save** starts with **99,999 coins**, once per test profile.
- Two free characters, two coin-unlock characters, two premium character previews.
- In the delivered local APK: clearly labelled offline demo ads; all real payments disabled.
- In the future native project: official Google sample ad IDs configured; SDK compilation still required.
- A neutral age choice appears on every fresh app launch, before native ad setup.
- **Only adults (18+) can request ads**, and live ads require regional consent.
  Children, teens and unknown-age players do not initialize/request ads.
- The intended audience includes children; the actual content rating is determined
  by the store questionnaire/review and is not guaranteed to be 3+.
- The test package is `com.subwayrunner.test2026`, separate from the lost-signing-key
  Metro Dash prototype. This is not the owner's final Play application ID.

## Game controls and features

Swipe left/right to change lanes, up to jump and down to slide. Double tap or use
the diamond button for the limited shield. Desktop controls are arrows/WASD,
Space to jump, H for shield and P/Escape for pause.

Trains move toward the player at their own speeds. Stationary trains have ramps
to roof routes. Pattern waves shift the available safe ground lane and leave time
to switch. The game includes coins, magnets, score multipliers, shielding,
progressive speed, one SDK-earned revive per run, saved high scores, three
per-run missions, music/effects and Low/Medium/High graphics settings.

Scene meshes are original procedural art. Train geometry is merged and cached
by material, coins use one instanced draw batch, and streaming objects are pooled.

## Run and verify source

Open `game/project.godot` with Godot **4.6.3**. The current compatibility renderer
supports OpenGL ES 3.0. Native monetized Android builds require Android 7/API 24+
because of the selected Mobile Ads SDK. Supported phone performance must still
be measured, including representative Redmi and Infinix devices.

On restricted machines point `XDG_DATA_HOME`, `XDG_CONFIG_HOME` and
`XDG_CACHE_HOME` to writable task-specific folders, rather than changing HOME.

```sh
godot --headless --path game --script ../tests/test_simulation.gd
godot --headless --path game --script ../tests/test_profile_ui.gd
godot --headless --path game --script ../tests/test_controller.gd
python3 -m unittest discover -s backend -p 'test_*.py'
python3 tools/check_release.py --channel test
```

`test_controller.gd` uses mocked native callbacks. Backend tests use a fake Google
adapter. Neither exercises real SDK ads, billing, credentials or money. Any
ObjectDB test-exit warning should be investigated separately from assertions.

## Native Godot Android compilation after tool access is available

1. Install Android SDK platform 36/build tools 36, Java 17+ and Gradle 8.14.x.
2. Install Godot **4.6.3** Android export templates and the matching Android build
   source template through the editor. Configure the editor's Java/SDK paths.
3. Follow `android/README.md` to build the DEBUG services AAR. The Kotlin plugin
   includes Billing 8.1.0, Mobile Ads 25.5.0 and UMP 4.0.0. Resolve actual compiler
   errors against those artifacts before reporting it compiled.
4. Run `android/install_addon.py`, enable the installed Godot export addon, install
   the Android build template and create an Android Gradle export preset.
5. Configure the test package above, version code 20, min SDK 24, target SDK 36,
   ARM64 (and ARMv7 if needed), INTERNET and ACCESS_NETWORK_STATE. Use a DEBUG
   keystore owned by the project; preserve it for future test updates.
6. Export a signed **test APK**. Check it with standard `apksigner verify` and
   `aapt2 dump badging`, then install and exercise it on an actual phone.

Test ads require a working Android SDK integration and network. Filling in sample
IDs alone cannot make ads work in the desktop/headless build. The parent-gated
test shop never reports a real purchase or grants paid entitlements from a click.

## Production work that is still required

The live release needs the owner's final package, AdMob app/ad-unit IDs, Play
products/prices, payments profile, developer website/app-ads.txt, support address,
privacy policy and truthful store disclosures. Distribution is limited to the
countries where Play and each product/service are available.

Deploy and wire the HTTPS purchase backend described in `backend/README.md`.
The current game intentionally stops at `purchase_pending_verification` and does
not yet apply live backend grants or server-bank spending. That client/server
integration must be completed and tested before enabling real payments. Anonymous
paid coin-wallet recovery across reinstalls/devices is not an account system.

Before production: test SDK consent/ad delivery, parental approval, pending/cancel,
refunds, receipt retries, permanent-product restoration, offline save behavior,
installation/update, touch controls, RAM, heat, battery and frame pacing on phones.
Use the owner's tester team and applicable Play closed-test/production access
requirements. Deliver a signed release AAB plus source and preserve signing-key
ownership/backups. Store approval and ad serving are external review outcomes.

`python3 tools/check_release.py --channel release` is expected to **fail** for
this preview configuration. A future SDK/Android/policy change or device bug may
require an update even after a fully tested initial release.

## Actual renderer preview

`release/Subway-Runner-WebGL-preview.png` is a frame of the actual WebGL shaders
and geometry replayed in local Mesa GLES. It is not a phone/WebView screenshot.
The older `offline-scene-preview.png` is a Blender illustration and should not
be presented as a game-engine capture. No Android performance claim follows from
either image. `tools/capture_webgl.cjs` and `tools/replay_egl.py` reproduce the
local shader/geometry validation without browser or display-server networking.

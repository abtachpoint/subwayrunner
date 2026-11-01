# Subway Runner v1.2.0 — final source implementation and acceptance status

**Built from:** the prior 2026-11-01 Final Upgrade ZIP, without overwriting the existing Android signing, AdMob, Firebase, Play Games, Play Billing, Cloudflare Worker or original model logic.

**Important distinction:** This is a **complete updated source-package handoff**, not an installed Android app and not a signed AAB/APK. No claim of 100% on-device verification is possible in this workspace. The user's previous AAB/APK reflect an earlier project version, not these new changes.

## Rechecked six gameplay reports

| Original complaint | Source status | Acceptance still required |
| --- | --- | --- |
| Age slider every launch | Existing persisted age-group recovery plus Android `set_age`; now adds a real second asset-prewarm stage only after initial confirmation | Kill/reopen Android application twice, check age remains stored and ad policy preserves under-18 restriction |
| Can't land on moving train roof | Existing revised simulation includes enhanced jumping, continuous ramps and moving train roof support | Real swipes and moving train roof contact on device |
| Too few moving/stopped trains | Existing convoy/stationary spawn waves, stable lane gaps | Multiple distance seeds and real gameplay difficulty |
| Down gesture crushes instead of sliding | **New:** actual Quaternius 65-joint humanoid `Slide_Loop` animation, with stable skinned mesh and no scale crushing; original fox/robot retain procedural animation | Test character selection, slide/roll and collisions on phone |
| Four city changes not visible | Existing 350m district transitions and 184 baked Kenney scene meshes | Observe 350m, 700m, 1050m on real device, ensure all textures/props and train scale correct |
| Shop cuts off runner body | Enlarged 3D character stage/camera + new finger-swipe orbit angle | Compare every runner's full-body framing on portrait phones |

## Imported and original assets

- 41 Kenney commercial-city GLB meshes, 40 suburban meshes, 103 train/track meshes, total **184**, converted to original, offline WebGL buffers and selectable scenic families.
- Two rigged Quaternius human meshes, each with roughly 8,483 unique vertices (eyes/face/body combined) and 65 bone influences.
- **12 genuine sampled skeletal motion clips**: idle, sprint, jog, jump, jump start, jump land, slide, slide start, slide exit, roll, crouch and crash.
- Human runtime uses offline `web/assets/skinned_characters.js` plus `web/skinned_player.js`: no network, CDN, external script or new Android SDK dependency.
- `courier` is the male model, `skater`, `sprinter`, `astronaut`, `neon` use a female-model variant with different color tint and their existing gameplay abilities. This is **not five separate unique body meshes**.
- Original playable Robot and Fox Fenn procedural animated rigs retained. Quaternius robot + seven farm animal meshes render as local scenery; **these FBX assets are not fully rig-retargeted playable runners**.
- User-provided original app icon remains in Launcher mipmaps and in splash artwork.
- 12 new original cartoon icon designs exported as both editable SVG and WebView-compatible PNG. No Subway Surfers media copied.
- Two original OGG arcade loops and twelve OGG effects remain available; removed overlapping synthesized secondary music while retaining movement/footstep/horn cues.

## UI/UX screens

| Requested view | Source implementation |
| --- | --- |
| Startup loading | Existing logo/art/progress, expanded real asset load-stage reporting |
| Age selection | Blue original panel with user-provided artwork and persistent age category |
| After-age loading | **New** local artwork + audio prewarm progress screen, bounded fallback |
| Main menu | Original logo, portrait animated character, working TAP TO PLAY, four illustrated buttons |
| Game over results | **New** full character-only WebGL portrait path with original blue panel and score/coins/distance |
| High score | Original orange celebration, now transparency fixed to reveal 3D character |
| Revive | **New** opt-in rewarded continuation popup, only if adult + signed in + backend run active; SSV grant still required |
| Multiplier reward | **New** blue star celebration, triggered on double-score powerup or applicable reward callback |
| Settings | Music, SFX and volume sliders, haptics toggle, display locale, Play Games, privacy/deletion, red close |
| Store and Shop | 2-column illustrated Diamond cards, consumable product lookup, character stage orbit gestures, additional Close button |
| Missions/Events | **New** local progress mission screen and honest daily reward/events hub, no invented online rewards |

**Design boundary:** Original Subway Runner identity inspired by colorful arcade runners, not an exact copy of Subway Surfers assets or layouts. Font styling uses available browser/system fonts; no externally bundled proprietary font.

## Existing live-service security boundaries

No changes to native authenticated reward, billing, Firebase or Worker verification internals. Automated backend tests are a partial source check only. Real live AdMob SSV, Play Games sign-in, Firebase cloud persistence, Play product activation, Cloudflare deployment, refunds, privacy, account deletion and Play Console acceptance are **not confirmed**. Configure privately and test via actual internal track.

## Build and verification

- `node --test tests/*.test.cjs`: **23 tests passed**, including 3 new real skinning/UI tests, 57 simulation checks and 150 integration UI checks.
- `npm --prefix worker test`: **29 tests passed**.
- `python3 -m unittest discover -s tests -p 'test_ci_*.py'`: **9 tests passed**.
- CPU skeleton test independently measured upright run 1.5m+ and physical low slide below 1m in model coordinates.
- Launcher icon/code/package/source static checks are in the current project test suite.
- **Not performed:** Android SDK compilation (SDK unavailable in this runtime), Codemagic cloud build, install/run on real Android, GPU WebGL screenshots (container browser access blocked), platform SSV/Google Billing live verification.

## Before publication — required acceptance checklist

1. Backup the current successfully-built GitHub branch. Extract source ZIP into a fresh folder and push to a new upgrade branch first. Do not erase `.git` or overwrite private keys.
2. Run Codemagic workflow `android-internal`; use the already authorized signing reference `subway_runner_upload`. Use a new Play-compatible `versionCode`; `versionName` is `1.2.0`.
3. Confirm both signed AAB and APK are emitted and match Play's upload-key certificate. Install new APK on target device and test every gameplay bug, character, City transition, Shop rotation and UI screen. A passing automated suite alone is not acceptance.
4. Test first-run age selection; kill app; restart twice; under-18 and unknown must not show rewarded ads.
5. Test free/rewarded/Diamond spin and one revive per run using signed-in Google Play test accounts; verify ledger/idempotency and SSV before enabling production rewards.
6. Verify only four Diamond pack IAPs, no banner/interstitial/app-open ad, cancellation/refund flows, Privacy/Deletion links and Play Console disclosures.
7. Record Android logs and file reproducible bugs. Only label **Production-ready** after actual device and live service testing, not merely after a ZIP is created.

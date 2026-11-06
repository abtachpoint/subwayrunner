# Visual, audio and gameplay update - change report

Date: 5 November 2026. Scope: the owner's follow-up list after the production handoff. Nothing in the
backend, Firebase, Play Games, AdMob or billing code was changed; the Android module is untouched.

## What was done, item by item

| # | Request | What changed | Where |
|---|---------|--------------|-------|
| 1 | Age slider only on first launch | The chosen age *group* (under13 / teen / adult, never a birthday) is stored in `localStorage` and restored at launch; the native ad layer is told the remembered group. A new **Change age** button in Settings reopens the slider (with Cancel). A corrupt stored value is ignored. | `web/app.js` |
| 2 | Polished human cartoon characters | Kai, Mira, Zuri, Bolt (mechanic), Nova (astronaut) and Flux are new procedural cartoon people with faces, hair or headgear, clothing details and shoes, on the **same 13-bone rig and pivots**, so animation, hit boxes and shadows are unchanged. Fenn the fox keeps his model. | `web/assets/humans.js`, `tools/build_human_runners.py`, `tools/meshkit.py` |
| 3 | Shop shows the full character | The preview camera now fits the whole body inside the preview panel (lens shift to the panel centre), the panel is larger, and the runner turns slowly; drag the panel to rotate by hand. | `web/renderer.js`, `web/app.js`, `web/style.css` |
| 4 | Down / slide / landing | The old squash is gone. Ground slide = baseball-slide pose (leans back about the hips, legs forward). Jump + down = tuck, then a forward roll on landing. Light dust puffs on landing, when a slide starts and while sliding. | `web/renderer.js` |
| 5 | Trains | New patterns: two metro trains rushing in side by side (escape lane stays open), a slower train pulling away **with a rear ramp that moves with it** so you can climb and run on a moving roof, two coupled coaches (one long roof run), and a parked pair side by side (ramp up, then switch roofs). Existing convoys are unchanged. | `web/simulation.js` |
| 6 | Environment and city change with distance | The four zones now also change *geometry*: Sunrise City (original) -> Green Line (houses, fences, trees, lawns) -> Golden Terminal and Neon Night (downtown blocks). Each new set is four street slices, mirrored to get eight. | `web/assets/city_extra.js`, `web/renderer.js` |
| 7 | Foot-over bridge | A covered footbridge spans the tracks every 550 m (one just before each zone change). Clearance is about 6.9 m, above any roof run or jump. | `web/assets/city_extra.js`, `web/renderer.js` |
| 8 | Sound | A procedural engine (no sample files): a serious minor-key run theme whose tempo rises with speed, a calmer menu theme, footsteps (different on train roofs), jump / slide / dive / roll / landing effects, a two-tone horn for every oncoming train, and rail-joint wheel clatter plus low rumble as trains pass, panned by lane. | `web/audio.js`, `web/app.js` |
| 9 | Home page | Big 3D **PLAY** in the middle of the screen, **Shop** top-left, **Settings** top-right (Play Games sign-in with a gamepad mark lives there), and a larger highlighted **Daily Spin** under Settings with an animated wheel that spins faster and glows when a free spin is waiting. | `web/app.js`, `web/ui3d.css` |
| 10 | 3D text and buttons everywhere | One CSS layer: extruded gradient titles, bevelled chunky buttons, 3D HUD pills, depth on panels and cards. Small text gets a lighter treatment so it stays readable. | `web/ui3d.css` |

Also fixed while there: **Fenn faced the camera while running** (his baked mesh faces +z, every animation assumes -z).
`humans.js` ships a copy turned 180 degrees; `fox.js` and `models.js` are byte-for-byte unchanged.

## Files

Added: `web/ui3d.css`, `web/audio.js`, `web/assets/humans.js`, `web/assets/city_extra.js`, `web/assets/fonts/README.txt`,
`tools/meshkit.py`, `tools/build_human_runners.py`, `tools/build_city_assets.py`, `tools/third_party/kenney/**` (CC0 source models),
`tests/assets.test.cjs`, `tests/audio.test.cjs`, `docs/CREDITS.md`, this report.
Changed: `web/app.js`, `web/renderer.js`, `web/simulation.js`, `web/style.css`, `web/index.html`, `tests/web_ui.test.cjs`,
`tests/web_simulation.test.cjs`, `tools/package_source.py`, `README.md`.
Unchanged by design: `web/assets/models.js` (SHA-256 pinned), `web/assets/fox.js`, `android/**`, `worker/**`, `codemagic.yaml`.

Menu button labels changed (`LET'S RUN` -> PLAY, `RUNNERS + SHOP` -> SHOP; Play Games sign-in moved into Settings); the UI tests were
updated to the new flow. The old test that expected the age question on *every* launch now expects it only once.

## What was verified here, and what was not

Verified in this environment (all pass):
- `node --test tests/*.test.cjs`: 17 of 17 pass (136 simulation, 157 UI, 364 asset and 31 audio checks among them).
- `python3 tests/test_ci_bundle.py` (9 tests) and `python3 tools/check_release.py`.
- The real game was booted in headless Chromium (software WebGL): a 3,400 m auto-steered run through all four zones with no script errors, all new
  train patterns appearing, plus screenshots of every changed screen. The audio engine ran against a real Web Audio context without errors (peak level 0.47).
- Per-frame vertices with no obstacles: original build 191k; new Sunrise 172k, Green Line 206k, Downtown 197k.

NOT verified (cannot be from here):
- The Android build itself (no Android SDK in this sandbox) - Codemagic will be the first compile.
- Frame rate, heat and battery on a real phone; how the music and effects *sound* and whether the mix is to your taste.
- The Play Games mark is a neutral gamepad icon, not Google's official logo (see credits).
- Everything listed as pending in the earlier production audit (Worker deployment, IAP activation, AdMob SSV, Firestore rules, Play Console forms).

## Needs a new AAB

All of the above is inside the app's web assets, so it needs one new Codemagic build. Nothing here changes backend or Play Console configuration.

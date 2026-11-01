# Historical report — superseded

The status below records the earlier 2026-11-01 source. For the revised 1.2.0 work, see `docs/FINAL_COMPLETION_AUDIT.md` instead; skinned human animation and more UI screens were added after this original report.

---

# Subway Runner — Final Requested Upgrade Source Handoff

**Updated:** 2026-11-01  
**Application ID:** `com.subwayrunner.bd`  
**Source basis:** conversation's `Subway-Runner-Latest-Claude-Handoff-Full-Source.zip` (the working AAB/APK ZIP itself was not available here).  
**Deliverable:** complete updated **source ZIP**, not a precompiled, signed AAB or APK.  
**Design identity:** original Subway Runner artwork and arcade audio; no extracted Subway Surfers copyrighted audio/graphics.

## Implemented code / bundled content

1. **User's exact uploaded 1536×1536 icon** downsized to 512×512 for Play Console and all five Android density launcher icons; AndroidManifest points to this icon. Godot legacy project icon updated as well.
2. **Age preference persistence:** selection now stores a coarse age group in local WebView storage. Startup restores it and calls Android `set_age` with the saved value instead of resetting to `unknown`. Ads remain unavailable to under-18/unknown players.
3. **Train roof physics:** a stronger jump can clear the 2.7m roofs; ramps have continuous ground traversal. Landings, roof support and dive-to-roll mechanics remain covered by simulation tests.
4. **Train density:** more wave types include train convoys (one engine and two following cars), stationary trains and roof ramps. The scripted generator ensures there is never an *instantaneous* three-lane wall in the tested seeds. This is NOT a guarantee that every random sequence can be survived without jumping.
5. **Four environment districts:** the original lighting profiles now shift every 350m, plus local 3D Kenney meshes replace the previous color-only districts with Commercial, Suburban, rail-yard and night-city scenery variants.
6. **184 real 3D Kenney meshes** from supplied CC0 packs imported as offline WebGL geometry: 41 commercial, 40 suburban and 103 train/track models. All 184 meshes are included in `web/assets/kenney_models.js` and mapped to selectable families; actual draw density depends on gameplay distance and quality setting.
7. **Quaternius Robot and seven Farm Animal shapes** baked as rendered environmental scenery in `web/assets/quaternius_props.js`; original rigged FBX files and CC0 sources staged under `asset_sources/`.
8. **Character Shop 3D preview** area enlarged to approximately 43% of the screen height and camera adjusted to show more of the character. Existing original playable rigs remain unchanged.
9. **Slide** character's whole skeleton now crouches and pitches forward rather than being vertically squashed; midair down-swipe remains fast-fall plus landing roll in the gameplay simulation.
10. **Cartoon UI:** new cohesive original glossy blue/white panels, green/yellow buttons, title treatment, original splash artwork from supplied icon, age selection, menu, shop, settings, score board, orange high-score celebration and reward/pause panel styling; portrait responsive layout.
11. **Original arcade music & sound:** two original synthesized music loops and twelve local effects (jump, slide, land, roll, crash, horn, pickups, buttons, reward, powerup, shield). Local audio playback plus separate persistent music and sound-effect volume sliders. No downloaded copyrighted Subway Surfers audio is included.
12. **Preserved Android service stack:** AdMob rewarded-only setup, native login, Firebase config, Cloudflare client, Google Play Billing and Codemagic `subway_runner_upload` signing reference remain present. Codemagic and Worker tests use portable Node test options.
13. **Original licensed animation sources:** selected Quaternius Universal Base Character GLTFs plus Animation Library 1 and 2 GLBs are included in `asset_sources/quaternius/`. They are available for later retargeting, **but their rigged clips are NOT yet played by the live WebGL character controller**. The existing original rig characters use procedural local animation.

## Verification performed here

- `node --test tests/*.test.cjs`: **20 test suites/subtests passed**, including 150 web UI checks and 57 revised simulation checks.
- `npm --prefix worker test`: **29 tests passed**.
- `python -m unittest discover -s tests -p 'test_ci_*.py'`: **9 tests passed**.
- `tools/import_kenney_assets.py`: 184/184 GLB assets converted; errors zero.
- Local preflight checked project/config resources but **cannot compile** because this runtime has no Android SDK 36, Android Build Tools 36, Gradle executable or owner's private keystore.
- Headless Chromium WebGL rendering test **could not complete due to GPU/EGL initialization failure in the container**. Screenshot visual quality and device FPS have not been verified.

## Explicitly not verified / incomplete

- **Signed AAB/APK not generated in this container.** The user already has previous artifacts; **a new Codemagic Build is required** for the upgraded code.
- **App installed and played on Android:** not tested in this session. No guarantee of device rendering, correct Kenney asset scale/orientation, train collisions, UI visibility and performance.
- **All desired Rigged Quaternius Character animations:** source clips are bundled; runtime retargeting and animation playback in the custom WebGL renderer are not implemented. Current procedural skeletons are not the original Quaternius skinned models.
- **100%-identical Subway Surfers screens:** not attempted; layouts are distinct original designs with a similar cartoon arcade aesthetic.
- **Live services:** AdMob SSV, Google Play Games sign-in, paid products, Cloudflare server verification, Firestore rules and Google Play acceptance cannot be confirmed by these local tests.
- **Actual simultaneous train traversal and long-run game fairness:** mathematical tests passed but Android gameplay must be inspected.

## Deployment steps

1. Keep an unmodified backup branch of the previous working source (`backup-before-final-upgrade`).
2. Extract this source ZIP **into a fresh folder**. It contains `android/`, `web/`, `worker/`, `asset_sources/`, `game/`, `codemagic.yaml`, `tests/` and `tools/` at its root. Never upload the ZIP itself as your repository root.
3. Compare with current `main` before replacing files: the current *successfully built* GitHub commit was not available in this container.
4. Push the extracted source to `main`, without deleting `.git`; use Termux `rsync -av --exclude='.git/'` or Codex/Git.
5. In Codemagic choose `main` and `android-internal`. The original `subway_runner_upload` Android signing reference must already be configured.
6. After Build Success, download the **new** AAB and APK. Check the upload certificate is the Play Console-approved upload key, and increase `ANDROID_VERSION_CODE` if Play Console already used that version code.
7. Install the APK on a physical Android phone, repeatedly launch the app, test child/adult age flows, train roofs, moving/stationary trains, slide, 4 district switches after distance thresholds, 3D shop previews and every popup and sound.
8. Before public rollout, verify Play Games, Firebase, backend SSV and actual Play Billing flows on an allowed test track, then complete Store listing, Data Safety, privacy and deletion disclosures.

## Developer source regeneration

`python tools/import_kenney_assets.py /directory/containing/kenney-zips`  
`python tools/import_quaternius_props.py /directory/containing/quaternius-zips`  
`python tools/generate_arcade_audio.py`

These build-time Python tools require `numpy`, `trimesh`, and `Pillow` for mesh conversion, and `ffmpeg` for audio conversion. The resulting runtime assets are **already included** in this ZIP and require no downloads at Codemagic build time.

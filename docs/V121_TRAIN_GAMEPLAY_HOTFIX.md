# Subway Runner — v1.2.1 gameplay hotfix (2026-11-02)

This package is **updated source code**, based on the owner's `v1.2.0` ZIP. It is **not** a compiled AAB/APK and has not been installed on an Android phone from this environment.

## Changes made (not just proposed)

1. **Train density:** reduced generated-wave spacing from 73–83m to 43–50m. Train convoys, stationary trains and visible barriers/lowbars now populate more of the scene. 3-car moving train convoys are retained.
2. **Unavoidable walls:** introduced eight-wave course districts with a reserved safe lane and two transition waves before the lane shifts, rather than abruptly moving the safe lane during overlapping convoys. This is intended to avoid false/unavoidable collisions from overlapping hazards.
3. **Roof gap / moving train contact:** added a short 0.19-second roof-support continuity window so the 1.8m gap between coaches does not turn into an invisible side collision. It expires quickly and does not make the player invulnerable elsewhere. Moving train roof landing remains jump-based; walking through the front of a train still crashes.
4. **Closed train roofs:** replaced the open cargo `train-carriage-box` mesh used as an invisible-roof passenger coach with closed passenger-style electric car meshes. Each visible train's roof height and model length are scaled to its gameplay collision volume based on inspected packed 3D geometry. The displayed roof is intended to line up with the simulation's 2.7m roof plane.
5. **Jump/slide obstacles:** increased regularly visible small `barrier` and `lowbar` obstacles in non-safe lanes. They remain avoidable and continue to use existing jump or slide controls.
6. **Backwards-facing rigged humans:** rotate Quaternius human characters 180 degrees in gameplay; preserve the camera-facing pose in Menu / Shop previews.
7. **Version:** bumped Android `versionName` to `1.2.1`; Codemagic manages monotonically increasing `versionCode` as before.
8. **Regression tests:** added `tests/v121_train_regressions.test.cjs` for moving train landing, roof continuity, train density, model/physics agreement, character orientation and collision-free reserved corridors.

## Verification here

- `node --test tests/*.test.cjs`: **28/28 passed** (includes 57 legacy simulation assertions, UI adapters and new v1.2.1 checks).
- `npm --prefix worker test`: **29/29 passed**.
- `python3 tools/preflight_android.py --source-only`: **passed** (reports signing and Android SDK as unavailable in this environment).
- Archive integrity verified after packaging.

## Not verified — do not claim it is production-ready yet

- Android WebGL on-device rendered train roof alignment, camera-facing human or actual swipe gestures.
- Real on-device unexpected auto crashes across all play styles and speeds.
- Codemagic Android SDK compilation and signed APK/AAB output for v1.2.1.
- Play Games, AdMob rewarded SSV, Firebase cloud sync, IAP purchase verification and deployed Cloudflare worker.
- Other v1.2.0 UI/character issues (robot and animal playable rigs, Reference-perfect UI) remain outside this targeted patch.

## Instructions for existing GitHub/Codemagic setup

Extract this ZIP to a new folder; sync it into a fresh **branch based on** `final-upgrade-v120` or your most recently successful build branch, preserving `.git`, the Play Upload Key and other private signing data. Use `git diff` to review changes and avoid replacing newer fixes. In Codemagic build the new branch with workflow `android-internal` and signing reference `subway_runner_upload`. Install the **new** APK and verify every item above *before* release or merging into `main`.

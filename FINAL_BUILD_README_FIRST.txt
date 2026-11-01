SUBWAY RUNNER — EXPANDED SOURCE RELEASE 1.2.0
===========================================

This ZIP contains full editable SOURCE CODE. It is not a compiled APK/AAB.
You already had AAB/APK from an older build. They do not include these upgrades.

CONTENTS:
- android/: Native Android app, Firebase, Google Play, AdMob, Billing.
- web/: Actual playable WebGL game, Kenney meshes, original icon and UI,
  2 human skinned models + animation runtime, arcade audio.
- asset_sources/: Original CC0 source models and animations for editing.
- worker/: Cloudflare backend and tests.
- tools/, tests/: Local automated tests and Codemagic tools.
- codemagic.yaml: Build signed AAB + APK using your existing signing reference.
- docs/FINAL_COMPLETION_AUDIT.md: Honest feature and testing status.

BEFORE BUILD:
1) Back up current working GitHub main/branch and current AAB/APK.
2) Extract ZIP to a fresh folder (do not push ZIP as a single source file).
3) Compare files with your current successful GitHub build. Do not overwrite
   signing secrets or delete .git.
4) Push the project source to a NEW branch, run Codemagic android-internal.
5) Confirm new versionCode is higher than the last uploaded Play release.
6) Test the signed APK on a real Android device before merging to main.
7) Verify live Play Games, Firebase, SSV, Billing and deletion in test track.

SOURCE TESTS (on a Node/Python environment):
node --test tests/*.test.cjs
npm --prefix worker test
python3 -m unittest discover -s tests -p 'test_ci_*.py'

NOT GUARANTEED: 100% real-device visuals, physical train collisions, live
Google Billing/AdMob/backend acceptance or every downloaded FBX becoming a
playable character. See the audit document. Do not publish until those pass.

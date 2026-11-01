SUBWAY RUNNER — FINAL SOURCE BUILD (2026-11-01)

UPDATED APP ICON: user's uploaded image embedded for Android/Play.
PROJECT: com.subwayrunner.bd
CODEMAGIC: main -> android-internal; signing reference subway_runner_upload
OUTPUT: This ZIP is SOURCE, not an APK/AAB. Codemagic must compile and sign it.

Start here: docs/FINAL_UPGRADE_DELIVERY_2026-11-01.md

Includes 184 rendered Kenney city/train WebGL meshes, robot + animal
scenery models, age persistence, moving/stopped trains, roof/ramp changes,
slide visual fix, 4 city lighting/scenery districts, original arcade UI/audio,
and selected licensed skeletal animation SOURCE assets.

ANIMATION LIMITATION: Quaternius source clips are in asset_sources, but the
current playable rigs still use the original procedural animation renderer.
Do not claim every imported skeletal animation is active without porting and
testing a skinned-animation runtime. Live AdMob/Google Play purchases are
not verified by the automated tests.

USER MUST TEST SIGNED APK ON ANDROID. No compiled signed build was created here.

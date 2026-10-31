# APK + AAB workflow adjustment

Added by ChatGPT after reviewing the owner-supplied Codemagic-ready project. This is a minimal CI-only change: `codemagic.yaml` now builds `:app:assembleRelease` after the signed AAB, verifies the APK with the Android SDK `apksigner`, and publishes `release/Subway-Runner-internal.apk` plus its SHA-256 checksum.

All existing game, WebGL models, textures, assets, gameplay, Android native integration, backend, Play Games and AdMob source files are byte-identical to the uploaded Codemagic-ready ZIP. No changes to runtime code.

The APK is signed using Codemagic's same managed upload keystore as the AAB, not a new/different generated key. Sideloaded APKs may require additional SHA-1 OAuth registration (upload-key certificate) for Google Play Games authentication; the Play-installed internal-testing AAB is the authoritative end-to-end authentication/payment test path.

Remote Android compilation, signed APK/AAB creation, live backend and Google Play services are NOT tested here. They must be validated on Codemagic and devices.

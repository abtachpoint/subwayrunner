# Subway Runner — consolidated release-target development update

This is an update to the **existing** Codemagic-ready Android WebGL game, not a game replacement or a demo.
The package/application ID remains `com.subwayrunner.bd`, Play Games resource `613238310945`, and the existing Firebase, AdMob, Google Play Billing and Cloudflare endpoint configuration is retained.

## Actual implemented source changes

1. **Running pace** — starts at 21 m/s, scales continuously with distance, with no fixed upper speed cap. Ground planner spacing and lane-response tuning were adjusted and regression-tested against seven seeds, including a 4 km course.
2. **City progression** — four dynamic shader lighting/atmospheric districts: Sunrise City, Green Line, Golden Terminal and Neon Night, with gradual palette blending every 1.1 km. The original city geometry remains intact. This is *not* four entirely different building model sets.
3. **Metro trains** — occasional 2- and 3-car moving convoys, using the original 3D train meshes, with realistic same-track spacing. Staggered adjacent stopped trains are also placed in selected waves.
4. **Train roofs** — retained original ramps/train-roof support plus staggered train transfers. Jumping between roofs uses the existing aerial lane switch and collision/support geometry; device-feel still needs testing.
5. **Rendering** — updated lighting, gradient skyline, environmental fog, subtle color variations, improved landing/idle animations, and original contact shadows. High-quality settings remain supported; no unsupported guarantee about phone GPU performance.
6. **Runner characters** — original six characters preserved plus a new original full-body rigged stylized fox character, Fenn. All character models, including the original six, remain bundled offline.
7. **Individual play styles** — courier quick lane recovery, skater longer slide, sprinter higher jump, robot extra shield charge, astronaut soft landing, neon short magnet pulse, fox treasure-sense magnet pulse. These are client-side gameplay effects, not client-granted currency.
8. **Jump and roll** — fast-fall/down swipe while airborne buffers a landing roll. Natural landing squash / blend added to existing skeletal renderer.
9. **Audio** — kept existing original synthesized music and effects; added generated footstep rhythm, intermittent incoming-train horn and landing/roll sounds. No copyrighted music assets introduced.
10. **Crash** — animated cartoon star burst and flash before the result screen.
11. **Main menu** — improved gradient treatment, animated Play button, badges, game identity and responsive visual layout.
12. **Age selection** — explicit 6–70+ slider, age-group-only handling, under-18/unknown ads restrictions retained, plus group fallback buttons.
13. **Loading** — actual resource *completion stages* displayed as loading progress, instead of a fake timer. This does not claim byte-level network transfer accuracy.
14. **Shop** — more visible live in-game full-body 3D character preview, character details/powers, preview any runner before purchase.
15. **Economy** — untouched primary Diamond currency, coin earnings and server-authoritative transactions.
16. **Spins** — untouched 1 daily free, up to 2 optional ad spins, 20 Diamonds per purchased extra spin, no diamond-spin daily cap.
17. **Ads** — untouched voluntary rewarded-only mode. No new automatic/banner/interstitial/app-open ad paths.
18. **IAP** — existing four consumable Diamond products and verification hooks remain in source.
19. **Play Games / Firebase** — existing auth, guest progress, privacy and deletion client integration remains in source.
20. **Backend** — existing worker code and atomic transaction/verification flow preserved; the Fox style was added to canonical Worker catalog. The Cloudflare worker still needs real secret setup, deployment, and end-to-end validation.
21. **Android release workflow** — existing signing-required Codemagic release AAB plus APK workflow preserved. It must run under the *owner's authorized upload key*, then pass Android device and Play internal tests.

## Critical boundaries before shipping

- **No signed AAB/APK has been produced in this environment.** Android SDK/Gradle toolchain and the owner's authorized upload keystore are unavailable here. The ZIP contains release-target **source** ready for CI, not a signed deliverable.
- Android WebView/WebGL GPU rendering, screen layouts on real devices, shader compatibility and frame rate have not been physically verified here; simulator, data and structural code tests do not replace these checks.
- Original giant geometry file `web/assets/models.js` is **byte-for-byte unchanged**. Newly added fox model is in `web/assets/fox.js`.
- No private signing key, service-account secret or billing credential was generated or committed.
- This code includes new features and is not an already-approved production release. Build on Codemagic, install the APK, validate visuals and gameplay, deploy/verify worker, run Play Games/AdMob/Billing sandbox checks, and then promote the AAB.
- Google Play products can be activated after the first AAB, provided the compiled product identifiers and client logic are correct.

## Package handling

Extract the ZIP and upload **its contents** into the GitHub repository root so `codemagic.yaml` is in the repository root. Run the `android-internal` Codemagic workflow with the authorized upload signing reference `subway_runner_upload`. Do not commit signing material or Worker secrets.

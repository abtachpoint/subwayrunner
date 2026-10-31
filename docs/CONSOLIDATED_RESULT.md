> Historical pre-Codemagic result. The owner has since verified Games ID613238310945.
> For the current upload-ready workflow and remaining private signing step, see
> [CODEMAGIC.md](CODEMAGIC.md) and [CODEMAGIC_RESULT.md](CODEMAGIC_RESULT.md).

# Consolidated update result

## Completed source

The existing delivered WebGL/WebView game is preserved. Course simulation,
renderer and original model assets match the pre-update SHA-256 baseline.
The final Android application module uses com.subwayrunner.bd and the supplied
Firebase JSON. Active SDK source integrates PGS v2/Firebase Authentication,
origin-restricted native messaging, explicit rewarded-only ads/UMP/SSV, Diamond
Billing and authenticated backend requests. The old Godot prototype/plugin is
preserved and excluded from this build.

The Worker source uses real Firebase/Google verification paths, Firestore
transactions, server UTC limits, exactly20-Diamond spins, global once-only
purchase/SSV markers, encrypted consume retries, refund polling/debt and
recent-auth account deletion with tombstones and retryable cleanup. No
production successful auth, paid purchase or ad reward is simulated.

## Local verification

See WEB_TEST_RESULTS.txt, WORKER_TEST_RESULTS.txt and SOURCE_PREFLIGHT.txt.
All local web/controller/preservation and Worker security/economy/storage tests
passed. SDK/provider events and remote storage in unit tests are adapters;
cryptographic tests use locally generated RSA/ECDSA signatures. These are not
live Google/Cloudflare/payment/SSV/deletion tests.

The seven structural preservation/wiring checks include the final Firebase
identity and absence of automatic/non-rewarded ads or embedded private keys.
Static Kotlin review found no blocking source defect, but is not compilation.
The stricter web deletion-confirmation regression now requires both success
fields, matching native behavior.

## AAB build result

Command: bash tools/build_android.sh
Result: preflight exits1, before Gradle compilation/lint/Android-unit-test tasks.
No AAB exists or is supplied. Missing local Gradle, Android API36/build-tools36,
actual PGS game-resource ID and authorized upload signing prevent a signed
internal-testing bundle here. Java21 is present. No upload key was invented and
the old LOCAL-TEST identity was not selected. Existing old test APKs are not this
consolidated release.

Prepared CI/local SDK commands produce release/Subway-Runner-internal.aab only
if the real build succeeds. An unsigned artifact cannot be uploaded until signed
with the authorized owner upload certificate.

## External service verification

No Google service-account secret or Cloudflare deployment binding was provided.
The Worker was not deployed. The supplied API/health, privacy and account-delete
URLs could not be fetched successfully using available tools; this does not prove
those sites are down, but prevents verification here. They must not be described
as operational, updated or tested.

Replacement policy/deletion sources are provided in public-info/. The no-app
public deletion route is explicitly a manual support email request. Automated
in-app deletion is verified only with offline adapters until deployment and a
real authenticated internal-track user test succeed. The public support process
and hosted policy content remain unverified.

## Only remaining external actions

1. Configure PLAY_GAMES_APP_ID from the actual Games resource export; verify the
   owner Games/Firebase credential linkage. Provided OAuth IDs are already used.
2. Add private Worker secrets and least-privilege Google IAM permissions, deploy
   Worker/Firestore rules, enable cron, and configure both rewarded units' SSV
   callback to https://subway-runner-api.abirahomod12113.workers.dev/admob/ssv.
   Exact secret names and commands are in worker/README.md. Do not paste keys in chat.
3. Run the prepared Android SDK build/CI with the authorized upload keystore,
   upload its signed AAB to Play internal testing, configure the four supplied
   Diamond product prices and license testers, and verify test certificate setup.
4. Publish/review the supplied public policy/deletion sources on the existing
   host and test both the in-app automated deletion and staffed no-app request.
5. Complete real-device/internal-track acceptance: sign-in/offline/sync, test ads,
   signed SSV and duplicate callbacks, purchase pending/cancel/consume/refund,
   UTC limits/concurrent spends, reinstallation and deletion. Complete the truthful
   Play Data Safety/age/consent and applicable production-access requirements
   before enabling explicit live ads and production distribution.

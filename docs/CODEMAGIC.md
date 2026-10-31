# Build the signed internal AAB with Codemagic

The repository-root `codemagic.yaml` builds the existing Android `:app` module
with the original game in `web/`. It runs the game and worker tests, Android unit
tests and lint, then builds and verifies an upload-key-signed release AAB. It does
not deploy the backend or publish to Google Play.

## One-time Codemagic setup

1. Import this source into a Git repository and connect it as an app in
   [Codemagic](https://codemagic.io/). The repository root must contain
   `codemagic.yaml`, `android/`, `web/`, `worker/`, and `tools/` together. If starting
   from a source ZIP, extract its contents into the repository root; do not commit
   an extra enclosing directory that hides `codemagic.yaml`.
2. Open your Codemagic team's **codemagic.yaml settings → Code signing identities
   → Android keystores**. Upload the **existing Play-authorized upload keystore**
   and enter its keystore password, key alias, and key password. Set its reference
   name to **`subway_runner_upload`**. Keep the original key and passwords backed
   up privately. Do not generate or substitute a new key for this build.
3. Select workflow **Subway Runner signed internal AAB** (`android-internal`) and
   start the build from the branch containing these files.
4. When the build succeeds, download `release/Subway-Runner-internal.aab` and its
   `.aab.sha256` file from the build artifacts. Keep the lint and test reports if
   you need to investigate a failure.
5. Upload the AAB manually to this app's **Google Play Console → Testing →
   Internal testing** release. Finish the required Play Console setup and invite
   your testers using the opt-in link. Each Codemagic build automatically gets
   a new `versionCode` as described below.

Codemagic's [managed Android signing](https://docs.codemagic.io/yaml-code-signing/signing-android/)
injects `CM_KEYSTORE_PATH`, `CM_KEYSTORE_PASSWORD`, `CM_KEY_ALIAS`, and
`CM_KEY_PASSWORD`. The setup script requires all four and a readable, nonempty
keystore with an absolute path before any downloads. A filename marked
`LOCAL-TEST` or `LOCAL_TEST` is rejected. It maps them to the app's `ANDROID_KEYSTORE_PATH`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` using
Codemagic's [`CM_ENV` file](https://docs.codemagic.io/yaml-basic-configuration/using-environment-variables/).
Neither passwords nor key contents are written to source, artifacts, or build
logs. No base64 key or separate signing environment group is needed.

Use the upload certificate authorized by Play Console. The Play app-signing
certificate identifies Play-installed builds and can differ from the upload
certificate; those fingerprints are not interchangeable. If the correct upload
key is unavailable, recover it or follow Play's upload-key reset process before
rerunning this workflow.

## Toolchain and configuration

The workflow uses `mac_mini_m2`, JDK 17, and Node 24. Codemagic documents
[these YAML settings and machine types](https://docs.codemagic.io/yaml-basic-configuration/yaml-getting-started/)
and [Android SDK availability on its Mac images](https://docs.codemagic.io/specs-macos/xcode-26-0/).
`tools/codemagic_setup.sh` accepts the SDK licenses and ensures Android platform
36, Build Tools 36.0.0, and platform tools are installed. It downloads Gradle
8.14.3 over HTTPS and checks the binary ZIP against Gradle's
[official SHA-256 reference](https://gradle.org/release-checksums/):

```text
bd71102213493060956ec229d946beee57158dbd89d0e62b91bca0fa2c5f3531
```

The verified Gradle distribution is selected through `GRADLE_EXECUTABLE`; the
runner's default Gradle is not used. Cached downloads are checked again before
extraction. The setup handles `yes` exiting with SIGPIPE after license acceptance
without hiding an actual `sdkmanager` error.

The setup computes `ANDROID_VERSION_CODE` as `100 + PROJECT_BUILD_NUMBER`, falling
back to `100 + BUILD_NUMBER`, using Codemagic's documented
[built-in build counters](https://docs.codemagic.io/yaml-basic-configuration/environment-variables/).
It persists this value through `CM_ENV` for Gradle. Values must be integers from
1 through 2100000000. If Play already contains a higher version code, add an
`ANDROID_VERSION_CODE` value under `environment.vars` in `codemagic.yaml` that is
greater than every previously uploaded code, for example `ANDROID_VERSION_CODE:
"300"`. Increment that explicit override for subsequent uploads until the
automatic counter exceeds the highest uploaded code, then remove the override
to resume automatic numbering. A local build without this variable defaults to
version code 100.

An account with billing enabled may optionally change `instance_type` to
`linux_x2` and add `ubuntu: 24.04` under `environment`; the script also supports
[Codemagic's Ubuntu Android SDK](https://docs.codemagic.io/specs-linux/ubuntu-24.04/).
The default Mac workflow does not require selecting a billing-only machine.

The owner-confirmed Play Games application resource ID is already
`PLAY_GAMES_APP_ID=613238310945`. The package remains `com.subwayrunner.bd`; the
existing Firebase public client configuration, OAuth client IDs, API URL, AdMob
application ID and rewarded ad-unit IDs remain in the source. No backend service
account, Cloudflare token, Google Play publishing credential, active product, or
reachable backend is required to compile this signed AAB. The worker tests use
Node's built-in test runner through `npm --prefix worker test`; they do not need
Wrangler installation or backend secrets.

## First upload, then activate services

The release uses `ADS_MODE=live` and `--ads-mode live` so the owner's real AdMob
application and rewarded unit IDs are already compiled into the AAB. Debug builds
always override this to Google's official sample ads. For internal testers of
the release AAB, register every test device in the AdMob UI and wait for test mode
to take effect before testing ads. Confirm Google's **Test Ad** label; mediation
networks need their own test setup. Google documents
[testing an existing build with your own ad-unit IDs](https://developers.google.com/admob/android/test-ads).

After the first AAB upload, finish Play Games tester/client configuration,
Firebase authentication and Play app-signing certificate registration, and
activate the four existing consumable products: `diamonds_100`, `diamonds_500`,
`diamonds_1200`, and `diamonds_2500`. Configure license testers and localized
prices in Play Console. Deploy/configure the existing backend URL with its
private service credentials, Firestore rules and required rewarded SSV settings
as described in [worker/README.md](../worker/README.md).

Those console and backend activations do not require rebuilding when the package,
compiled IDs, product IDs, and endpoint remain the same. Test the Play-installed
build: Play Games/Firebase sign-in, account deletion, purchase verification and
restoration, consent, rewarded revive and spin, and server-confirmed rewards.
An ad completion callback alone must not grant a production reward. An artifact
proves the build and signing checks passed; operational service checks still need
the owner's consoles and actual devices.

## If a build fails

- **Missing keystore or `CM_KEY_*`:** check the exact `subway_runner_upload`
  reference in Code signing identities and the key's passwords/alias. The workflow
  intentionally refuses an unsigned release.
- **SDK, JDK, or download failure:** read the setup step, confirm JDK 17 and the
  image's Android SDK, and retry a transient download. A checksum mismatch stops
  the build; do not bypass verification.
- **Lint, Kotlin, tests, or signature verification:** open the failing step and
  downloaded reports, fix the source or correct upload signing, then rerun.
- **Play rejects the signing certificate:** check the app's upload certificate in
  Play Console and select its corresponding keystore in Codemagic. Do not replace
  the key just to make compilation pass.
- **Play rejects a reused version code:** set an `ANDROID_VERSION_CODE` override
  greater than the highest code already uploaded and rebuild.
- **A compiled feature is unavailable on a device:** complete the relevant
  console/backend activation and tester access, then retest the installed build.

## Signed output verification

The bundle verifier authenticates every non-META-INF payload with the JDK,
rejects unsigned/mixed/tampered payloads and compares the signer with the public
certificate from the configured managed upload keystore. The private key and
passwords are never exported. The public SHA256 fingerprint and artifact checksum
are recorded in `release/Subway-Runner-internal.aab.build.json`. Optionally set
`EXPECTED_UPLOAD_CERT_SHA256` to the Play Console upload-certificate fingerprint
for an additional check; do not substitute the different Play app-signing SHA1.
The bundle is copied to the published artifact path only after verification.

The CI runs local verifier tests with ephemeral synthetic fixture keys/ZIPs in
temporary directories. These fixtures are not game builds and are never signed
with the owner key or published as AAB artifacts. Only the actual Gradle
`bundleRelease` output can reach the declared application artifact path.

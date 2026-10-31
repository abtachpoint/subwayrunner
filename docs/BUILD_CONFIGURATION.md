> Current signed-build workflow: [CODEMAGIC.md](CODEMAGIC.md). The owner has now
> verified Games ID613238310945 and it is configured. Codemagic installs the
> missing local toolchain and requires managed owner upload signing. Backend
> deployment and product activation do not gate the first AAB build.

# Consolidated Android build and external configuration

The shipped game is the existing `web/` WebGL game. The coordinated update adds
a normal Android `:app` module with production SDKs around those same assets;
it does not replace the renderer, course, controls or character models. The old
Godot sources/services remain archived development work, not the active host.

## Local build result and current limits

The inspected execution environment contains Java **21.0.12.1**, but no Gradle,
Android platform, Android build tools, `sdkmanager` or `adb`. Its SDK and Gradle
directories are empty. A single bounded default-network probe to Google's SDK
repository exited immediately with `curl: (7) Failed to connect to proxy port
8080`. No escalation/download approvals were requested by this build workflow.

Consequently **no SDK compilation, lint, Android unit-test task or AAB build has
been run here**. JavaScript/Worker unit tests and configuration checks are separate
and do not prove an Android SDK integration compiles. Dependency versions must
resolve and compile on the prepared CI/local Android environment before release.

The existing `.signing/LOCAL-TEST-*.pem` identity belongs to the offline prototype.
It is not evidence of an authorized Play upload key and is never selected for the
release application. The Play app-signing SHA-1 supplied by the owner identifies
Google Play's signing certificate; the upload certificate may be different.

## Reproducible SDK build

Install Java 17+, Gradle **8.14.3**, Android SDK platform **36** and build tools
**36.0.0**. Set `ANDROID_HOME` to the SDK directory. A standard Gradle executable
is used; no unverified/generated wrapper JAR is supplied as though it were official.

Place the provided Firebase file in `android/app/google-services.json`. Its app
client must remain `com.subwayrunner.bd`, project `subway-runner-513217` and
Firebase App ID `1:613238310945:android:a6a750a7838becef4bbb60`.

The owner-verified Games resource ID613238310945 is already set in
`android/gradle.properties`. Codemagic uses that same explicit ID. Android and server OAuth client
IDs are already configured in the application source; the Firebase JSON has no
OAuth client list and does not itself supply the Games ID; the owner's separate verification does.

```sh
python3 tools/preflight_android.py --source-only
bash tools/build_android.sh
```

This runs real Gradle `:app:testDebugUnitTest`, `:app:lintDebug` and
`:app:bundleRelease` tasks. On success, an internal AAB is copied to:

`release/Subway-Runner-internal.aab`

No AAB path is a claim that the file currently exists. The script fails if Gradle
does not produce a real bundle. Internal builds use Google's **test rewarded ad
units** by default. Release build type alone must not enable production ads.

## Owner upload signing

Supply all four values privately in your shell/CI secret store:

| Environment variable | Meaning |
| --- | --- |
| `ANDROID_KEYSTORE_PATH` | Private file path to authorized upload keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Upload-key alias |
| `ANDROID_KEY_PASSWORD` | Upload-key password |

The build script never prints password values or reads private key content for
diagnostics. If signing is unavailable, the internal build may produce an
**unsigned AAB**; it cannot be uploaded until owner signing is configured.

```sh
bash tools/build_android.sh --production
```

Production additionally requires real PGS resource configuration, owner signing
and explicit live ad mode. Live ad IDs are the owner's already supplied IDs;
they are not regenerated. Testing purchases still requires a Play-distributed
build, the fixed diamond products, configured prices and license testers.

## Prepared GitHub workflow

`.github/workflows/android-internal.yml` installs the actual toolchain, runs game
and Worker tests, runs Gradle and preserves real output/reports. It does not
publish the app, upload to Play or deploy the Worker automatically.

Configure repository variable `PLAY_GAMES_APP_ID` and the four signing secrets
above, except the private file itself is provided as secret
`UPLOAD_KEYSTORE_BASE64`; CI decodes it into temporary private runner storage.
Do not put keystores, service-account JSON/private keys, passwords or OAuth client
secrets in the source repository or chat. Never commit the generated temporary key.

## Backend deployment and live validation

Use the deployment configuration and exact secret names in `worker/README.md`.
The configured Worker name is `subway-runner-api`; its URL is
`https://subway-runner-api.abirahomod12113.workers.dev`. The code must be deployed
with owner Cloudflare access and private Google service credentials before its
health/profile/purchase/reward/deletion flows can be called operational.

Typical owner commands after credentials are configured:

```sh
cd worker
npm install
npm test
npx wrangler deploy --dry-run
npx wrangler deploy
```

Secrets are entered using `wrangler secret put NAME` or the Cloudflare dashboard,
not committed `.dev.vars` content. Deploy the included deny-client Firestore
rules; native clients use the authorized Worker, not direct currency writes.
Grant the server service account only the required Android Publisher, Firestore
and account-deletion permissions. Existing purchase-verifier permissions alone
do not establish Firestore/Firebase Auth administration access.

Configure both rewarded ad units' SSV callback to the Worker's `/admob/ssv`
route. Test signatures, duplicate callbacks, missing ads, interrupted ads,
purchase pending/cancel/retry/consume, UTC rollover, atomic spending and account
deletion on a Play internal track. SDK earned callbacks alone never prove a
server reward. Google sample ad inventory does not establish that the owner's
SSV callback is configured or delivers to the deployed Worker.

The provided privacy/deletion URLs have not been fetched successfully from this
restricted environment. Review their actual content against the included
implementation and test the complete account-deletion path after deployment;
the mere existence of a public URL is not a completed deletion feature.

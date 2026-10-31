# Codemagic build preparation result

## Configured

- Owner-verified numeric Play Games resource ID613238310945. Manifest metadata
  references the generated play_games_app_id string. OAuth IDs remain unchanged.
- Actual existing Android :app project; game, UI, renderer, models and integrations
  preserved. No engine rewrite, fake SDK or substitute bundle.
- Root codemagic.yaml on mac_mini_m2 with JDK17, Node24, SDK36/Build Tools36.0.0,
  checksum-verified official Gradle8.14.3 and managed subway_runner_upload signing.
- Signing fails safely if the existing upload key, passwords or alias are missing.
  No release key is generated. All AAB payload signatures are verified and matched
  to the configured keystore's public certificate before artifact publication.
- Automatic version codes, test/lint reports, artifact SHA256 and public signer
  metadata. There is no automatic Google Play publishing.
- Release includes the supplied endpoint, real AdMob IDs and four Diamond product
  IDs, so their external activation can follow the first upload without changing
  those compiled identifiers. Debug always uses official samples. Register actual
  release test devices in AdMob before ad testing.
- Backend secrets, a deployed Worker, active products and Google Play publishing
  credentials are not build prerequisites or pipeline gates.

## Verification

Local game/controller/preservation and Worker security/economy tests pass. Nine
CI-verifier/configuration tests cover unsigned rejection, tampering, wrong signer,
matching a configured fixture keystore, complete payload structure, verified
Games ID wiring and fail-fast missing managed signing. Fixture bundles/keys are
synthetic temporary tests, not compiled Android applications or published output.
Shell syntax and YAML structure pass. Isolated setup tests exercise version-code
bounds, private CM_ENV mapping, missing/relative/prototype keys, SDK license
SIGPIPE handling, SDK error propagation and Gradle checksum rejection.
Static Android/official API audit is in CODEMAGIC_AUDIT.md.

## Actual remote result

There is no connected GitHub repository or Codemagic account/token in this
workspace. No remote commit or Codemagic build was performed. The upload-ready
ZIP has codemagic.yaml directly at its root. The owner must import these files
into GitHub, connect that repository in Codemagic, register the existing authorized
upload keystore and start workflow android-internal. The remaining private signing
inputs are exactly the keystore file, keystore password, alias and key password.
Google Play decides whether this is its registered upload certificate; it may
differ from the app-signing certificate previously supplied.

Successful real output paths:
- android/app/build/outputs/bundle/release/app-release.aab
- release/Subway-Runner-internal.aab
- release/Subway-Runner-internal.aab.sha256
- release/Subway-Runner-internal.aab.build.json

These are future CI output paths. No AAB is fabricated or claimed to exist here.
If the first actual SDK build finds a compiler/dependency/lint error, its reports
must be fixed and the workflow rerun; local/static tests do not prove compilation.

See CODEMAGIC.md for exact Codemagic screens, steps, signing reference and upload.
After internal-track upload, finish the already identified console/backend and
public policy/deletion setup, then test live identity, payments and signed SSV.

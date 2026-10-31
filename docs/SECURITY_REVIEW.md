# Consolidated integration review

This review distinguishes local code verification from Android/Google/Cloudflare
deployment testing. Source presence and mocked SDK callbacks are not proof that
authentication, advertising, purchases or deletion work against production.

## Preservation baseline

The delivered game is the existing `web/` WebGL game hosted by Android WebView.
The new Android app must package those assets directly. The older Godot prototype
and Godot-only service library are retained as source, not substituted for the
delivered game or accidentally added to the active Gradle app.

`tests/consolidated_static.test.cjs` records the pre-update SHA-256 hashes of the
simulation, renderer and model assets, and checks final package/Firebase wiring,
the active ad surface and absence of embedded private keys. These are structural
checks, not Kotlin compilation or an Android runtime/security proof.

## Review status

Static native review found no blocking source-level regression; this is not a
Kotlin compilation or SDK API/runtime certification. Confirmed exact-origin and
main-frame bridge restriction, native-only credentials, UID purchase binding,
server verification before grants/consumption, verified-SSV-only rewards and
recent reauthentication before deletion. Web deletion confirmation now requires
both explicit completion fields, matching native behavior; malformed partial
confirmations have a regression test.

Local JS/controller, Firestore-adapter, crypto, concurrency, replay, purchase,
refund and deletion-retry tests pass. Unit fixtures and adapters are not evidence
of live Google/AdMob/Play/Cloudflare operation. Actual signed internal-track
acceptance and a compiled Android SDK build remain required.

## Known external configuration boundary

The supplied Firebase configuration matches the final project/package. Its OAuth
array is empty, so the server OAuth client is explicit. The owner has separately
verified Games app_id613238310945 and it is now configured as a resource in the
active app and Codemagic workflow. No inference from the Cloud number is needed.

Only the old prototype's local-test PEM signing identity is present. It is not an
established authorized Play upload signing key. The app must use owner-provided
upload signing configuration for a signed internal-testing release.

No Cloudflare deployment token, Google service-account private key or deployed
backend verification has been established in this workspace. Secrets must remain
in the owner's private Cloudflare secret store and must not be packaged with the
Android app or source archive.

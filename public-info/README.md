# Public information deployment

These are reviewed replacement **source files**, not a claim the supplied live
Worker was updated. Publish privacy.html as the root/index page on the existing
public-information host, and delete-account.html at the already supplied path.
Adjust its privacy link to `/` when publishing privacy.html as index.html.

The app links to the supplied external URLs. This workspace could not fetch those
pages or the API hostname successfully, so their existing content and service
behavior remain unverified. No external website was modified.

In-app deletion uses authenticated, recently reauthenticated native requests to
the actual backend and reports completion only on explicit server confirmation.
The public no-app deletion path is a **manual support email request**: it opens
the user's mail client, not an automated identity/deletion API. The operator must
verify account ownership and complete the secure deletion process, keep this
route staffed and test it before release. Do not advertise automatic web deletion
or a fixed completion deadline unless it is actually implemented and supported.

Review provider disclosures, retention, Google Play/Families/Data Safety answers
and local requirements against the deployed SDK behavior and policies. The age
screen is not a verified date of birth; ads are intentionally unavailable below
18/unknown. Account deletion does not delete the player's Google account or Play
Games profile and does not automatically refund a Play purchase.

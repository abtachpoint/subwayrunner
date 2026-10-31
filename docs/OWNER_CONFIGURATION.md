# Owner-supplied public configuration

The provided Firebase file is installed at `android/app/google-services.json`.
Do not replace it with a service-account JSON file; those credentials belong only
in private server secret storage.

| Configuration | Value |
|---|---|
| App/package | Subway Runner / `com.subwayrunner.bd` |
| Firebase/Cloud project | `subway-runner-513217` |
| Cloud project number | `613238310945` |
| Firebase Android App ID | `1:613238310945:android:a6a750a7838becef4bbb60` |
| Android OAuth client | `613238310945-60iq3quh7h3ukq711u0uhdq5ucp3qiqh.apps.googleusercontent.com` |
| Web/Game Server OAuth client | `613238310945-2i9sn4s6j2458pcbb87atclvkul2h79s.apps.googleusercontent.com` |
| Play app-signing SHA-1 | `FE:E2:74:91:E8:72:71:20:8D:04:E1:0E:5D:41:00:D6:8D:90:AA:25` |
| AdMob application | `ca-app-pub-1379059201302335~7903669960` |
| Rewarded revive | `ca-app-pub-1379059201302335/6015873225` |
| Rewarded spin | `ca-app-pub-1379059201302335/7963379715` |
| API | `https://subway-runner-api.abirahomod12113.workers.dev` |
| Firestore database | `(default)` |
| Privacy | `https://broken-mountain-7eb6.abirahomod12113.workers.dev/` |
| Deletion page | `https://broken-mountain-7eb6.abirahomod12113.workers.dev/delete-account.html` |
| Support | `abirahomod12113@gmail.com` |

The Android OAuth client is linked through the owner's Play Games package and
certificate registration; it is not used as the server OAuth client ID. The SDK
exchanges a server authorization code for Firebase credentials using the supplied
Web/Game Server client ID.

The owner has now verified **Play Games app_id613238310945** on the Play Console
Configuration page. It is stored in `android/gradle.properties` and Codemagic
configuration and is generated as the Android string resource/manifest metadata.
This is not either full OAuth client ID; numeric equality with the separately
provided Cloud project number is legitimate here because the owner confirmed it.

Only four one-time consumable purchase products are active:
`diamonds_100` (100/USD0.99), `diamonds_500` (500/USD3.99),
`diamonds_1200` (1200/USD7.99), `diamonds_2500` (2500/USD14.99).
Base prices are informational configuration; the app displays Play's localized
product price and cannot complete a purchase when Play reports it unavailable.
There is no cash spin product or active old coin-pack IAP.

Owner upload signing and backend deployment secrets remain external configuration.
The verified Play Games ID is already set; no replacement ID is requested.
The local prototype signing identity is not the owner's authorized Play upload
key. No upload keystore or backend private service key was invented.

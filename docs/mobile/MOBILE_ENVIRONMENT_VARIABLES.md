# Mobile environment variables (STEP 37)

**Names only.** No value, key or password appears here or in the repository. "Secret" means: set only in the hosting environment (Vercel) or the CI secret store, never in the app, never in Git.

## Website (Vercel project variables)

| Name | Secret? | Purpose |
|---|---|---|
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | no | the site's public address; the apps may show this host |
| `ANDROID_PACKAGE_ID` | no | Android application id used in `assetlinks.json` (default `com.lifepartnerpro.app`) |
| `IOS_BUNDLE_ID` | no | iOS bundle id used in `apple-app-site-association` and as the APNs topic |
| `MOBILE_ALLOWED_HOSTS` | no | extra hosts the apps may show or link from, comma separated |
| `ANDROID_SHA256_CERT_FINGERPRINTS` | no (public) | SHA-256 fingerprints of the upload key and the Play App Signing key; empty = no Android link is claimed |
| `APPLE_TEAM_ID` | no (public) | Apple Team ID; empty = no iOS link is claimed |
| `MOBILE_ANALYTICS_ENABLED` | no | `true` turns on anonymous usage counts (default off) |
| `MOBILE_ENCRYPTION_KEY` | **yes** | optional dedicated key for push tokens at rest; else derived from `NEXTAUTH_SECRET` |
| `FCM_PROJECT_ID` | no | Firebase project id |
| `FCM_CLIENT_EMAIL` | **yes** (treat as one) | Firebase service-account e-mail |
| `FCM_PRIVATE_KEY` | **yes** | Firebase service-account private key (`\n` line breaks are accepted) |
| `APNS_KEY_ID` | **yes** (treat as one) | Apple push key id |
| `APNS_TEAM_ID` | no | Apple Team ID (falls back to `APPLE_TEAM_ID`) |
| `APNS_PRIVATE_KEY` | **yes** | contents of the Apple `.p8` push key |
| `APNS_BUNDLE_ID` | no | push topic if different from `IOS_BUNDLE_ID` |
| `APNS_ENVIRONMENT` | no | `production` or `sandbox` (TestFlight/development builds use sandbox) |

### Things that are *not* environment variables

| The brief's name | Where it lives instead | Why |
|---|---|---|
| `ANDROID_MIN_VERSION`, `IOS_MIN_VERSION` | Control Center → Mobile apps → App versions | changeable without a deployment, versioned and audited |
| `PUSH_PROVIDER` | chosen by platform: Android → FCM, iOS → APNs | there is nothing to choose |
| `MOBILE_PUSH_ENABLED`, `MOBILE_DEEP_LINKS_ENABLED` | feature flags `mobile.push.enabled`, `mobile.deep_links.enabled` | emergency disable, rollout, approval |
| `FCM_CLIENT_ID` | not used | the HTTP v1 API needs the project id and a service account |

## Build / CI (GitHub → Settings → Secrets and variables → Actions)

| Name | Kind | Purpose |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` | secrets | the Android **upload** key |
| `GOOGLE_SERVICES_JSON_BASE64` | secret | per-project Firebase configuration for the Android build |
| `IOS_CERTIFICATE_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_KEYCHAIN_PASSWORD` | secrets | iOS signing |
| `APP_URL`, `LPP_APP_HOST`, `ANDROID_PACKAGE_ID`, `IOS_BUNDLE_ID`, `APPLE_TEAM_ID`, `IOS_SIGNING_ENABLED` | variables | public build settings |

## Build properties read by the project

`LPP_ANDROID_PACKAGE_ID`, `LPP_VERSION_NAME`, `LPP_VERSION_CODE`, `LPP_APP_HOST`, `LPP_KEYSTORE_PATH`, `LPP_KEYSTORE_PASSWORD`, `LPP_KEY_ALIAS`, `LPP_KEY_PASSWORD`, `LPP_REQUIRE_SIGNING` (Android Gradle); `MOBILE_APP_VERSION`, `MOBILE_BUILD_NUMBER`, `MOBILE_BUILD_TYPE`, `IOS_BUNDLE_ID`, `LPP_APP_HOST`, `APPLE_TEAM_ID`, `APP_URL`, `MOBILE_ALLOWED_HOSTS` (shell config and the iOS script).

`.env.example` carries the website names above as empty placeholders.

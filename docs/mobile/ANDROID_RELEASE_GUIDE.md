# Android release guide (STEP 37)

Everything in the repository is ready to build; the steps below need accounts, keys and a machine that only the owner has. Nothing secret is ever written into the repository.

## 0. What you need

| Item | Who | Notes |
|---|---|---|
| Google Play Developer account | owner | one-time registration fee; identity verification |
| Firebase project (for notifications) | owner | free tier is enough |
| An upload keystore | owner | made in step 2; **never** committed |
| GitHub repository secrets | owner | names listed in step 4 |
| (optional) Android Studio, JDK 21, Node 22 | developer | only to build on a laptop |

## 1. Identifiers

* Package id: `com.lifepartnerpro.app` (default). Change it **before** the first upload by setting `ANDROID_PACKAGE_ID` (website) and `LPP_ANDROID_PACKAGE_ID` / the repository variable `ANDROID_PACKAGE_ID` (build). After the app is published it can never change.
* Website host for App Links: `LPP_APP_HOST` (default `lifepartnerpro.vercel.app`). If you move to your own domain, change it and the `APP_URL` variable together, and rebuild the app.

## 2. Create the upload key (once)

On a trusted machine, with the JDK installed (the values in angle brackets are yours to choose; use a password manager):

```bash
keytool -genkeypair -v -keystore lpp-upload.keystore -alias lpp-upload -keyalg RSA -keysize 2048 -validity 10000
```

* **Ownership:** the owner of the Google Play account owns this key. Keep two encrypted copies in separate places (password manager attachment + an offline encrypted drive).
* **Never** commit it, e-mail it or paste its password into a chat or an issue. `.gitignore` blocks `*.keystore` / `*.jks`, and a test fails if one is committed.
* Use **Play App Signing** (the default for new apps): Google holds the key that signs what people install, and this upload key only proves uploads come from you. If the upload key is lost or leaked, the account owner can ask Google to reset it from the Play Console (App integrity). That is the recovery process.

## 3. Firebase (notifications)

1. In the Firebase console create a project and add an **Android app** with the package id from step 1 (and add `<package id>.debug` if you want notifications in debug builds).
2. Download `google-services.json`. Store it **as a GitHub secret** (`GOOGLE_SERVICES_JSON_BASE64`: the file, base64-encoded). It is not a password, but it is per-project configuration and is kept out of Git.
3. Project settings → Service accounts → *Generate new private key*. From that JSON, set three **server** variables in Vercel (Production): `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY`. Never put these in the app or in GitHub.
4. In Control Center → Feature flags switch `mobile.push.enabled` on when ready.

## 4. GitHub secrets and variables (Settings → Secrets and variables → Actions)

| Name | Kind | Value |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | secret | the keystore file, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | secret | keystore password |
| `ANDROID_KEY_ALIAS` | secret | alias (`lpp-upload`) |
| `ANDROID_KEY_PASSWORD` | secret | key password |
| `GOOGLE_SERVICES_JSON_BASE64` | secret | from step 3 |
| `APP_URL`, `LPP_APP_HOST`, `ANDROID_PACKAGE_ID` | variables | public values |

## 5. Build the release bundle (.aab)

*One-time:* the workflow file is stored as `mobile/ci/mobile.yml`; add it to `.github/workflows/mobile.yml` in the GitHub web editor so Actions can see it.

* **In CI (recommended):** Actions → *Mobile release* → Run workflow → give the version (for example `1.0.0`) and a **build number that is higher than every earlier upload**; tick *require signing* for a store build. The job type-checks, lints, runs every test and the security scan, builds `bundleRelease`, checks the bundle contains no key, Firebase file or source map, and keeps the `.aab` and the R8 `mapping.txt` for 14 days.
* **On a laptop:**
  ```bash
  cd mobile && npm ci
  # signing values come from your environment, never from a file in the repository
  LPP_VERSION_NAME=1.0.0 LPP_VERSION_CODE=1 npm run android:bundle
  ```
  The bundle is `mobile/android/app/build/outputs/bundle/release/app-release.aab`.

Release builds are minified and shrunk (R8), not debuggable, and do not allow plain-text traffic or cloud backup. The web view only shows the website's own host; anything else opens in the phone's browser.

## 6. First upload

1. Play Console → create the app (name *Life Partner Pro*, free, app not a game). Complete the store listing and the policy forms using `GOOGLE_PLAY_STORE_CHECKLIST.md`.
2. Testing → **Internal testing** → create a release → upload the `.aab` → add testers. Install from the Play link and run `MOBILE_TESTING_GUIDE.md`.
3. Crash reports are made readable by the R8 mapping, which the bundle already carries in `BUNDLE-METADATA` (Google Play reads it; it is not delivered to phones). The workflow also keeps `mapping.txt` as an artifact if you want to upload it separately.
4. App integrity → copy the **SHA-256 certificate fingerprint(s)** of both the upload key and the *app signing key* into the website setting `ANDROID_SHA256_CERT_FINGERPRINTS` (comma separated) and redeploy. `https://<host>/.well-known/assetlinks.json` then lists the app, and Android verifies the links.
5. Closed testing → Open testing → Production, using the staged rollout. Record each step in Control Center → Mobile apps → Releases (moving a build to *production* needs approval).

Google currently requires new personal developer accounts to run a closed test with a minimum number of testers for a minimum number of days before production access; check the Play Console "Production access" page for the numbers that apply to you now.

## 7. Updating

Raise `LPP_VERSION_CODE` for every upload. After a release is live, set the **recommended** version in Control Center → Mobile apps → App versions. Raise the **minimum** only when an older app must stop working (it shows an update screen). The update link can only be the official Play listing.

## 8. If something goes wrong

* Paused rollout: move the release to *paused* in the console and in Control Center; use `mobile.maintenance.enabled` or `mobile.android.enabled` to switch the app off from the server.
* Links not opening the app: `adb shell pm get-app-links <package id>` shows verification state; the usual cause is a missing/incorrect fingerprint in `ANDROID_SHA256_CERT_FINGERPRINTS`.
* Notifications not arriving: Control Center → Mobile apps → Push shows whether the server is configured and why messages were skipped.

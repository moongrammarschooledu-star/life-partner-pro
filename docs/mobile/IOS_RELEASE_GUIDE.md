# iOS release guide (STEP 37)

The iOS project is prepared and compiles in CI for the simulator without any Apple account. Everything that follows needs the owner's Apple Developer account and a Mac (or the CI macOS runner with the secrets below).

## 0. What you need

| Item | Who |
|---|---|
| Apple Developer Program membership | owner |
| App Store Connect access (App Manager or higher) | owner |
| A Mac with Xcode (or the CI job) | developer |
| An APNs authentication key (`.p8`) | owner |

## 1. Identifiers

* Bundle id: `com.lifepartnerpro.app` by default. Change it before the first upload with `IOS_BUNDLE_ID`; after publishing it can never change.
* Team ID: the 10-character id shown in the Apple Developer account. Set `APPLE_TEAM_ID` on the website (it appears, publicly and harmlessly, in `apple-app-site-association`) and as a GitHub variable.
* `node mobile/scripts/configure-ios.mjs` writes the bundle id, version, build number, team and the Universal Links host into the Xcode project and `App.entitlements`. It is run by CI; run it by hand on a Mac before opening Xcode.

## 2. Apple Developer portal

1. Identifiers → register the App ID with the bundle id. Turn on **Push Notifications** and **Associated Domains**.
2. Keys → create an **APNs key** (token-based). Download the `.p8` once; Apple will not show it again. Put its contents in Vercel as `APNS_PRIVATE_KEY`, and set `APNS_KEY_ID` and `APNS_TEAM_ID` (and `APNS_ENVIRONMENT=production`). Keep an offline backup. **Never** put it in Git, the app or GitHub.
3. Certificates / profiles: an *Apple Distribution* certificate and an *App Store* provisioning profile for the bundle id.

## 3. Build on a Mac

```bash
cd mobile && npm ci
IOS_BUNDLE_ID=... MOBILE_APP_VERSION=1.0.0 MOBILE_BUILD_NUMBER=1 LPP_APP_HOST=... APPLE_TEAM_ID=... node scripts/configure-ios.mjs
npx cap sync ios
npm run ios:open        # opens Xcode
```

In Xcode: select the *App* target → Signing & Capabilities → pick your team (the capabilities Push Notifications and Associated Domains come from `App.entitlements`) → Product → Archive → Distribute App → App Store Connect.

## 4. Build in CI

The *Mobile release* workflow always compiles the app for the simulator (proves the project builds). To also produce a signed `.ipa`:

1. Add secrets `IOS_CERTIFICATE_BASE64`, `IOS_CERTIFICATE_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_KEYCHAIN_PASSWORD` and variables `IOS_BUNDLE_ID`, `APPLE_TEAM_ID`, `LPP_APP_HOST`, `APP_URL`.
2. Set the repository variable `IOS_SIGNING_ENABLED` to `true`, and (recommended) protect the `mobile-ios-release` environment with required reviewers.
3. Run the workflow. The job installs the certificate into a temporary keychain, archives, exports the `.ipa`, keeps it 14 days and deletes the keychain. Upload the `.ipa` with Transporter or Xcode.

This signed path could not be exercised on the development machine: expect to fix small signing details on the first run.

## 5. TestFlight

App Store Connect → TestFlight: add internal testers, install, and run `MOBILE_TESTING_GUIDE.md`. Add external testers only after the first build passes Beta App Review.

## 6. App Review

Use `APP_STORE_CHECKLIST.md`. The points that matter most for this app:

* **Minimum functionality (4.2).** In the review notes explain what the app does beyond the website: push notifications, private notification display modes, Universal Links, device lock with Face ID, privacy screen, device management and native sign-out.
* **Account deletion (5.1.1(v)).** Account Settings → Request Account Deletion works inside the app; the public page `/delete-account` describes it.
* **Sign in with Apple** is not required: the app offers no third-party social sign-in.
* **Reviewer access.** Apple needs a working account. The owner creates a dedicated test profile (a real registration, verified by an administrator) and puts its Profile ID and the way to receive the sign-in code in the *App Review Information* fields. Do not use a real applicant's data, and do not share a real person's e-mail address.
* **Payments.** Membership purchase is blocked inside the app (`mobile.payments.enabled` off). If you later sell memberships in the app, Apple's in-app purchase rules apply; that needs a decision and a separate build of the purchase flow.

## 7. Universal Links

`https://<host>/.well-known/apple-app-site-association` is empty until `APPLE_TEAM_ID` is set; then it names `<TEAMID>.<bundle id>` and the approved routes only. After the app is installed from TestFlight, tapping a listed link on the phone should open the app; a link to a record you do not own opens "not found", never the record.

## 8. Notifications

Set the APNs variables above, switch `mobile.push.enabled` on, install the TestFlight build, turn notifications on from *Account Settings → Your devices*, and use *Send a test*. TestFlight and development builds use the sandbox APNs service: set `APNS_ENVIRONMENT=sandbox` while testing those, then `production` for the App Store build.

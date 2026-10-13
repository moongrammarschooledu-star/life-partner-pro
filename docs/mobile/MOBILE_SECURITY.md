# Mobile security (STEP 37)

The mobile apps never decide anything: every request is authorised by the same server code as the website. This document lists the controls that were added, how each is checked, and what is **not** covered.

## 1. Threats and controls

| Area | Control | How it is checked |
|---|---|---|
| Stolen or replayed session | The app uses the website's signed, HTTP-only session cookie. It is not readable by page scripts and is not copied into app storage. Sessions are server-side rows (`ProfileSession`, `FamilyMemberSession`) that can be revoked, expire, and are validated on every request. | existing session tests; `mobile-flow.test.ts` (removing a device revokes its session) |
| Remote logout | "Remove device" and "Sign out" revoke the device's session and delete its push token; "Log out other sessions" already exists. An administrator can remove a lost device. | `mobile-flow.test.ts` |
| IDOR via devices | Every device call filters by the signed-in owner; someone else's id behaves like a missing one (404). | `mobile-flow.test.ts` ("no IDOR") |
| IDOR via links | A deep link is only a route. For a record the server first checks the caller may open it (the website's own visibility function) and answers "not found" for both "missing" and "not yours". | `mobile-flow.test.ts` |
| Token leakage | Push tokens are AES-256-GCM encrypted in the database, never returned by any API, never logged, and only decrypted inside the sender. | `mobile-security.test.ts` |
| Notification leakage | Titles and bodies are generic (private by default); the data part carries only a notification id and an in-app path. No name, number, or proposal detail. Marketing is never pushed. | `mobile-rules.test.ts` |
| Spoofed or tampered version | A missing or malformed version counts as the oldest and is told to update. The update link can only be an official store page. Server-side, device registration is refused below the minimum (HTTP 426). | `mobile-rules.test.ts`, `mobile-flow.test.ts` |
| Fake update endpoint | The app only opens the store address the server returns, and that address is restricted to `play.google.com` / `apps.apple.com`. There is no download-and-install path. | `mobile-rules.test.ts` |
| Downgrade | The version policy has a minimum; older installs are blocked from registering and shown an update screen. (A rooted phone can bypass its own UI, but cannot bypass server authorisation.) | `mobile-flow.test.ts` |
| Malicious navigation | The web view may show only the site's own host (`allowNavigation`); any other address opens in the phone's browser. Only `https` is accepted; plain-text traffic is disabled on Android and not allowed on iOS. | `mobile-project.test.ts` |
| JavaScript bridge | No custom bridge is added. Capacitor's bridge is available only to the site's origin. | `mobile-project.test.ts` |
| Exposed Android components | One exported component only (the launch activity). App Links list exact routes. No custom URL scheme (nothing another app could claim). | `mobile-project.test.ts` |
| Insecure backup / debug | `allowBackup=false`, data-extraction rules exclude everything, release is not debuggable, web debugging off and logging off in release. | `mobile-project.test.ts` |
| Hard-coded secrets | None in the app. Signing keys, Firebase and Apple files come only from CI secrets, are written to a temporary folder and deleted. Tests fail if a key, keystore, `google-services.json` or `.p8` is committed. | `mobile-project.test.ts`, `security-scan` |
| Debug build shipped | Debug builds use a different application id (`.debug`) and cannot replace the store build. | `mobile-project.test.ts` |
| Source maps / mapping files | The R8 mapping is kept as a CI artifact and also travels in the bundle's `BUNDLE-METADATA` folder, which Google Play uses to read crash reports and which is **not** delivered to phones. The bundle check rejects web source maps, keys, keystores and Firebase files anywhere else in the bundle. | CI step "Validate the bundle" (first run: bundle built; the check was too strict about BUNDLE-METADATA and was corrected) |
| Screenshots / app switcher | On the screens for documents, proposals and verification the privacy-screen plugin hides content from screenshots and the app-switcher thumbnail where the phone supports it. | route list tested; effect needs a device |
| Clipboard | Not controlled. The app does not copy anything private to the clipboard. | n/a |
| Abusive device calls | Per-person rate limits on registration, push test (3 per 10 minutes) and deep-link resolve; public endpoints are rate limited; analytics accepts only a fixed list of event names. | `mobile-security.test.ts` |
| Tampered analytics | Only twelve event names are accepted; anything else (including extra fields) is dropped; nothing identifies a person. | `mobile-rules.test.ts` |
| Biometric | An optional lock for this phone only. Nothing biometric is sent or stored by us. If it fails or is unavailable the person can sign out of the device (recovery) and sign in again with the normal e-mail code. | needs a device |

## 2. Security events

The existing security event bus records `MOBILE_DEVICE_REGISTERED`, `MOBILE_DEVICE_REMOVED`, `MOBILE_SESSION_CREATED`, `MOBILE_SESSION_REVOKED`, `MOBILE_PUSH_TOKEN_CHANGED`, `MOBILE_BIOMETRIC_ENABLED/DISABLED`, `MOBILE_DEEP_LINK_OPENED` (with `ALLOWED` / `REFUSED`), `MOBILE_APP_UPDATED` and `MOBILE_SECURITY_WARNING` (an installation changing owner). They carry platform, versions and a reason word, never a token or a number. `MOBILE_LOGIN_FAILED` is defined for future use: failed sign-ins already raise `LOGIN_FAILED` through the existing sign-in routes, and the apps use those routes unchanged.

## 3. Deliberate non-measures

* **Certificate pinning is not used.** Pinning a certificate in a remotely loaded app risks locking every user out when the certificate rotates, and Vercel rotates certificates automatically. TLS validation uses the phone's system trust store only (user-installed CAs are not trusted on Android).
* **No root / jailbreak detection and no anti-screenshot on every screen.** They are easy to bypass, add false alarms, and the brief asks not to use invasive measures without a clear requirement. Sensitive screens are covered by the privacy screen instead.
* **No tokens in app storage.** See the architecture note: the session cookie is the credential.

## 4. Review items that need a device or an account

The following cannot be verified from source and are listed in `MOBILE_PRODUCTION_READINESS.md` as open: the web view really loads the plugin bridge on the remote site, App Links / Universal Links verification, push delivery on both platforms, the biometric flow, the privacy screen, the signed bundle and archive.

## 5. Reporting

A security finding in the apps is handled like one in the website (Security Operations). Mobile security events appear in Control Center → Mobile apps and in the SOC event stream.

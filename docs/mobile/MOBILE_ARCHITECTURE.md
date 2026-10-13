# Mobile architecture (STEP 37)

## The decision

Life Partner Pro is a Next.js application on Vercel with one PostgreSQL database. Its applicant dashboard, family portal and public site are already responsive web pages, and the website is already an installable PWA (STEP 35). So the mobile strategy is:

**Existing web app → PWA → native shell (Capacitor) for Android and iOS.**

The apps are a thin native wrapper that shows the website in a locked-down web view and adds the few things a browser cannot do well: push notifications, verified app links, an optional device lock (fingerprint / face), hiding sensitive screens from screenshots, and a store presence. They hold **no business logic, no secrets and no copy of the data**.

### Why not React Native or Flutter

* Matching, proposals, verification, membership, communication, privacy and security all live on the server and in the existing pages. A native rewrite would duplicate every one of them, double the testing and fork the security model.
* One set of pages means a fix reaches web, PWA, Android and iOS the same day, without a store review.
* The brief says not to rebuild when the existing application can be packaged safely. It can.

### Trade-offs, stated plainly

* **Apple review (guideline 4.2, "minimum functionality")** can reject an app that is only a website in a frame. What the app adds on iOS (push notifications, Universal Links, the device lock, privacy screen, native sign-out and device management) is the case we make; it is not a guarantee. See `IOS_RELEASE_GUIDE.md`.
* The app needs a network connection. The only offline content is a small page that says so (private data is never kept for offline use, on purpose).
* The web view loads the live site, so what people see changes when the website changes. Only the native shell itself (permissions, links, plugins) needs a store release.

An Android "Trusted Web Activity" would also have been possible, but it cannot offer push, the device lock or the privacy screen, and would leave iOS with a different stack. One Capacitor project covers both.

## Picture

```
Life Partner Pro
  |
  +-- Public website ----------------+
  +-- Applicant dashboard            |   one Next.js application, one API,
  +-- Family portal                  +-- one set of permissions and approvals
  +-- Admin portal (web only)        |
  +-- PWA (installable website) -----+
  |
  +-- Android app  ---- web view of the site + native plugins (push, links, lock)
  +-- iOS app      ---- web view of the site + native plugins (push, links, lock)
  |
  +-- Shared backend: PostgreSQL, file storage, notification services, security layer
```

The administrator portal is deliberately **not** part of the apps: administrators use the website.

## Where each thing lives

| Concern | Where | Notes |
|---|---|---|
| Native shell | `mobile/` (Capacitor 7), `mobile/android`, `mobile/ios` | No Java/Kotlin/Swift business code. One generated activity, one app delegate. |
| What the app asks the server | `src/app/api/mobile/*` | version, config, devices, push token, deep-link resolve, anonymous counts, preferences |
| Mobile services | `src/lib/mobile/*` | device ownership, push providers, deep-link rules, version policy, releases, analytics |
| Bridge between page and shell | `src/components/mobile/native-bridge.tsx`, `devices-card.tsx` | does nothing in an ordinary browser |
| Control Center page | `/admin/control-center/mobile` | versions, devices, push health, links, releases, errors |
| Tables | `MobileDevice`, `MobilePushDelivery`, `MobileVersionPolicy`, `MobileRelease`, `MobileEventCounter`, `NotificationPreference.pushDisplayMode` | |
| Link verification files | `/.well-known/assetlinks.json`, `/.well-known/apple-app-site-association` | empty until the signing / team values are configured |
| CI | `mobile/ci/mobile.yml` | builds and validates; publishes nothing |

### What was reused (nothing duplicated)

| Existing system | How the apps use it |
|---|---|
| Applicant / family cookie sessions and revocable `ProfileSession` / `FamilyMemberSession` | The web view keeps the same session cookies. There is no second token system. Removing a device revokes its session. |
| `requireApplicantProfileId`, `requireFamilyMemberId` | The mobile guard calls them; restrictions and account status apply unchanged. |
| `sendNotification` and its privacy-safe templates | A push is mirrored from an in-app notification that was already created. Push never decides on its own to notify. |
| Notification preferences, restrictions, quiet hours | Applied before any push is sent. |
| Privacy centre, export and the STEP 13 deletion workflow | The app's Account Settings *is* the website's. A public page `/delete-account` explains the process for the store listings. |
| Account Settings sessions list | Remains the security centre; the new "Your devices" card sits beside it. |
| Feature flags (STEP 36) | `mobile.*` flags, with rollout, emergency disable and approvals. |
| Security event bus (STEP 24/32) | `MOBILE_*` event types. |
| Configuration change log and approval gate (STEP 36/19) | Version-policy and release changes; production release needs approval. |
| Error capture | The apps tag crash reports with platform and version (`/api/client-errors`). |
| Analytics governance (STEP 31) | Counts of fixed event names only; off unless enabled. |
| Membership / payments (STEP 14/27) | The app never decides an entitlement. A checkout from inside the app is refused until `mobile.payments.enabled` is on. |

## Authentication model

The apps use the website's own sign-in (profile ID + e-mailed one-time code for applicants; invitation / sign-in for family members). The session is an HTTP-only, signed cookie kept by the web view, so **no authentication token is ever readable by JavaScript or written to app storage**. This is stronger than copying a bearer token into app storage, and it means "log out" and "log out other devices" already work server-side.

The brief's "secure storage / Keychain / Keystore" requirement therefore applies to what the app *does* store: only a random installation id (not a secret) and the optional device-lock choice. The lock itself uses the phone's biometric prompt and never sends biometric data anywhere.

## What the server enforces for every sensitive request

Authentication → session validation (revocation, expiry) → restrictions and account status → resource ownership → consent / permissions → audit. The apps add nothing that weakens this chain: a deep link or push tap only navigates to a page, and that page performs the usual checks. A deep link to a record is first resolved by the server (`POST /api/mobile/deep-link/resolve`), which answers "not found" for both "does not exist" and "is not yours".

## Honest limits of this build

* Nothing here has been run on a phone: the development machine has no Java, Android SDK or Xcode. The Android bundle is built by CI; the iOS app needs macOS. See `MOBILE_PRODUCTION_READINESS.md`.
* The plugin objects are read from `window.Capacitor.Plugins` because the pages are served from the website, not bundled into the app. This is the documented way for a remotely loaded app, but it must be confirmed on a device (`MOBILE_TESTING_GUIDE.md`, test 1).
* Push needs a Firebase project and an Apple push key that only the account owner can create.

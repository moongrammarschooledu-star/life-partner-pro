# Mobile production readiness (STEP 37)

Status date: 2026-10-13. Every number below was produced on this machine on that date; nothing is estimated.

## Overall status: **MOBILE_NOT_READY** for a store release

The server side (device registry, push, deep links, version policy, release log, Control Center page, privacy and deletion page, tests, documents) is built and tested. The apps themselves **have not been built into a signed bundle or run on a phone**, and none of the account-owner steps has been done. The brief asks that `MOBILE_PRODUCTION_READY` not be claimed until build, signing, push, deep-link and production checks pass; those checks cannot pass until the items under "Requires …" below are done. The honest label is therefore *not ready*; the path to *ready with warnings* is listed in section 6.

| Part | Status |
|---|---|
| Website, PWA, backend, Control Center, tests, documents | Built; ready to merge and deploy (additive migrations) |
| Android project | Generated and hardened; **never built here** (no Java / Android SDK on this machine). CI is prepared to build the bundle |
| iOS project | Generated and hardened; **never built** (needs macOS). CI is prepared to compile it and optionally archive it |
| Push notifications | Built and unit-tested against recorded requests; **never sent to a real phone** (needs Firebase and Apple keys) |
| Deep links / App Links / Universal Links | Logic built and tested; the verification files are empty until the owner supplies fingerprints and the Team ID; **never opened on a device** |
| Store listings | Drafts written; screenshots, feature graphic and accounts are the owner's |

## 1. Completed automatically (and checked)

* Architecture decision and document (`docs/mobile/MOBILE_ARCHITECTURE.md`): website → PWA → Capacitor shell; nothing duplicated (no matching, proposal, CRM, verification, payment, membership, communication, risk or authorization logic in the app).
* Tables and enum values (two additive migrations, validated): `MobileDevice`, `MobilePushDelivery`, `MobileVersionPolicy`, `MobileRelease`, `MobileEventCounter`, `NotificationPreference.pushDisplayMode`, 11 `MOBILE_*` security events, 4 audit actions. Sessions, security events, audit and notifications reuse the existing tables.
* Device registry with ownership rules, removal that revokes the session, a 10-device cap, owner change handling and token re-assignment.
* Push: provider abstraction, FCM HTTP v1 and APNs token providers (no SDK), encrypted tokens, privacy modes, quiet hours, preferences, restrictions, per-device cap, dead-token handling, fail-open hook in the notification service (lazy, wrapped).
* Deep-link allow-list and resolver (answers "not found" for anything the person may not open), `assetlinks.json` and `apple-app-site-association` that claim only what is configured.
* Version policy (minimum / recommended / latest), update screen in the app bridge, release log with approval gate for production (`MOBILE_PRODUCTION_RELEASE`), configuration history entries.
* Nine `mobile.*` flags with sensible defaults (push, biometrics, payments, maintenance, new dashboard OFF).
* Control Center → Mobile apps page; 3 permissions (`platform:mobile:view|manage|push`), staff roles hold none.
* App bridge (version check, device registration after sign-in, push registration only after the person taps "Turn on notifications", link and notification-tap resolution, optional device lock with a sign-out recovery path, privacy screen on sensitive routes, anonymous event counts); "Your devices & notifications" card for applicants and family members; offline banner for web, PWA and apps.
* Account deletion: the existing STEP 13 workflow, plus the public page `/delete-account` (footer-linked, in the sitemap and route map).
* In-app purchase gate: a membership checkout started from the app is refused until `mobile.payments.enabled` is on; entitlements remain server-decided.
* Hardened native projects, adaptive icons, splash screens and launch pages generated from the brand mark; `mobile/` has its own ignore rules; signing keys, Firebase and Apple files can never be committed (ignore rules + a test).
* CI workflow `mobile.yml` (checks → Android bundle build and validation → iOS compile → optional signed iOS archive), no step prints a secret, nothing is published.
* Documents: architecture, Android and iOS release guides, both store checklists, security, privacy, push, deep links, testing, release process, environment variables (`docs/mobile/`).

### Verification run (this machine, 2026-10-13)

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| ESLint | 0 errors (warnings are the existing ones) |
| Full test suite | **230 files, 2963 tests, all passing** (115 new: rules 35, flows 38, security 23, project hygiene 19) |
| Security scan | PASS |
| Route audit | 0 critical, 0 high, 8 medium (the same medium class as before; no new mobile route among them) |
| Migration check | 40 migrations valid |
| Bugs found by the new tests and fixed before delivery | push path accepted `//evil`; one public route lacked try/catch; route audit did not know the mobile guard |

## 2. Requires developer credentials / accounts (owner)

* **Install the CI workflow once:** copy `mobile/ci/mobile.yml` to `.github/workflows/mobile.yml` in the GitHub web editor (the assistant's token cannot create workflow files).
* Firebase project; service account → Vercel variables `FCM_*`; `google-services.json` → CI secret.
* Apple push key (`.p8`) → Vercel `APNS_*`; Apple Team ID; certificate and App Store profile → CI secrets.
* Android upload keystore (made once, backed up, never committed) → CI secrets.
* A decision on the final website domain (links and the app are tied to the host; the default is the current Vercel address).

## 3. Requires Google Play Console action (owner)

Create the app; store listing and the policy forms (`GOOGLE_PLAY_STORE_CHECKLIST.md`); real screenshots and feature graphic; Data safety form; content rating; target audience; reviewer test account; internal → closed → open → production testing as Google requires for the account type; upload the bundle and `mapping.txt`; copy the Play App Signing fingerprint into `ANDROID_SHA256_CERT_FINGERPRINTS`.

## 4. Requires Apple Developer action (owner)

App ID with Push and Associated Domains; APNs key; App Store Connect record; privacy labels; age rating; screenshots; reviewer account; TestFlight; submit (`APP_STORE_CHECKLIST.md`, `IOS_RELEASE_GUIDE.md`). Guideline 4.2 (a site in a frame) is the main review risk and cannot be guaranteed.

## 5. Requires production provider configuration

`FCM_*` and `APNS_*` set in Vercel and `mobile.push.enabled` switched on; `ANDROID_SHA256_CERT_FINGERPRINTS` and `APPLE_TEAM_ID` set so the link files list the apps; optionally `MOBILE_ANALYTICS_ENABLED`; the approval policy for `MOBILE_PRODUCTION_RELEASE` created (open Approvals once after deployment).

## 6. Requires human review

* The privacy policy, `/delete-account`, the store descriptions, the Data safety and privacy-label answers (and `LEGAL_PAGES_REVIEWED`).
* Whether and how a minimum age applies in each country (STEP 23 jurisdiction rules; no age rule was hard-coded).
* Whether memberships will ever be sold inside the apps (store billing rules): today the app refuses purchases.
* Wording for Apple's review notes.

### What must happen to move to "READY_WITH_WARNINGS"

1. Merge, deploy, apply the migrations; create the approval policies.
2. Run *Mobile release* in CI and get a green Android bundle; fix whatever the first real Gradle / Xcode run reports (expected: small things such as plugin versions or signing details; the project could not be compiled on this machine).
3. Install on at least one current and one older phone per platform and pass `MOBILE_TESTING_GUIDE.md` scripts 1–13. **Script 1 matters most**: it confirms the plugin bridge is available to a remotely loaded site; if not, push, links and the lock need a small change in the shell.
4. Configure Firebase / Apple push and prove a notification arrives with generic text.
5. Verify App Links / Universal Links on a device.
6. Complete the console forms and the owner-side items above.

## 7. Known limitations and deviations from the brief (disclosed)

| Brief item | What was done | Why |
|---|---|---|
| Secure token storage (Keystore / Keychain) | No token is stored: the web view keeps the website's HTTP-only session cookie | The cookie is the credential; copying it into app storage would be weaker |
| Tables `mobile_sessions`, `mobile_installations`, `mobile_deep_link_events`, `mobile_security_events`, `mobile_app_configurations`, `mobile_audit_logs`, `mobile_push_tokens` | Reused existing session, security-event, audit and configuration tables; push token is a column of the device; five new tables | "Do not duplicate existing" |
| `/api/mobile/sessions` | Not added: the existing `/api/my-account/sessions` and `/api/family/sessions` list and revoke sessions, and a device is linked to its session | No duplication |
| `/api/admin/mobile/*` | Under `/api/admin/platform/mobile/*`, beside the other Control Center routes | Consistency with STEP 36 |
| Flag "version targeting" | Version policy per platform (minimum / recommended); a flag cannot target "versions below X" on its own | Flag evaluation has no version dimension |
| Bulk notifications with approvals | Not built: no admin broadcast exists, only a fixed test message | "Do not create a spam system" |
| Notification templates admin for push | Push reuses the existing in-app notification templates (already privacy-safe) | No second template system |
| "Mobile maintenance" | `mobile.maintenance.enabled` plus the platform maintenance mode (the app shows a notice) | Reuse |
| PWA screenshots in the manifest | Not added | Real production screenshots do not exist yet; none are fabricated |
| iOS and Android end-to-end flow (§56) | Not run | No device, account or build yet |
| Duplicate-submission prevention for forms (§5) | Not changed in this step | Existing forms keep their own handling; a general review is a separate task |
| Screenshot protection | Plugin on documents, proposals and verification routes only | Not invasive everywhere |
| Certificate pinning, root detection | Not used (explained in `MOBILE_SECURITY.md`) | Outage and false-alarm risk |
| Payment through Google Play Billing / App Store | Not built; in-app checkout refused | Needs a product and legal decision |
| Announcement banners inside the apps | Not built | Same as the website: STEP 36 note |

## 8. Final audit questions (§57)

| Question | Answer |
|---|---|
| Duplicate backend logic? | None: the app adds no business logic; mobile services import none of the AI, finance, matching, CRM, promotions or referrals modules (tested) |
| Duplicate authentication / notification / payment / membership / privacy / security system? | No |
| Secrets in the repository? | None; ignore rules and tests block keys, keystores, Firebase and Apple files |
| Debug configuration shipped? | Release is not debuggable, web debugging and logging off, debug build has a different id |
| Insecure storage? | No token or private data is stored by the app |
| Unauthorised deep links / IDOR? | Server-checked; tested for devices and links |
| Insecure web view? | Own host only; https only; no custom bridge |
| Notification privacy leakage? | Generic text by default; tested that names and numbers never reach the payload |
| Broken account deletion? | Existing workflow unchanged; new public page; not exercised in an app build |
| Broken push, session revocation, flags, version management? | Covered by tests; push and links are unproven on a device |

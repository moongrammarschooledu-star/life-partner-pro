# Mobile testing guide (STEP 37)

## 1. What is tested automatically (every normal test run and CI)

| File | What it proves |
|---|---|
| `src/lib/mobile/mobile-rules.test.ts` (35) | version policy and spoofed versions; the store-address rule; what a push may show (private by default, no names or numbers, marketing never pushed); every deep-link refusal (hosts, schemes, traversal, secrets, control characters); quiet hours across midnight and time zones; identity configuration; analytics sanitising; the FCM and APNs requests and error mapping; the Apple ES256 token signature; push-token encryption |
| `src/lib/mobile/mobile-flow.test.ts` (38) | devices over an in-memory database: registration, ownership change, device cap, no IDOR, removal revokes the session, push-token handling, the dispatcher (flags, preferences, restrictions, quiet hours, cap, dead token, family), releases and the approval gate, version policy, deep-link resolver, analytics storage |
| `src/lib/mobile/mobile-security.test.ts` (23) | every mobile route is guarded and rate limited; tokens never leave the server; no SQL / shell / `eval`; push is lazy and fail-open; the association files claim only what is configured; permissions are sensitive and unavailable to staff; the in-app checkout gate |
| `src/lib/mobile/mobile-project.test.ts` (19) | the committed Android / iOS project: no credentials, reviewed dependencies, https only, no backup or debug, one exported component, exact App Links, release shrink and signing from the environment, permission strings, the CI workflow does not print secrets or publish |
| `src/lib/route-auth-coverage.test.ts`, route audit | the new routes are in the reviewed lists |

These do **not** prove the app runs on a phone.

## 2. Device matrix

| | Minimum | Also test |
|---|---|---|
| Android | the oldest version you support (API 23 / Android 6) and one current (Android 14–15) | a small screen (≈5") and a large one, one tablet, slow network, airplane mode, dark mode, large font size |
| iOS | the oldest supported (iOS 14) and one current | a small iPhone (SE) and a Pro Max, an iPad, slow network, airplane mode, dark mode, large text |

## 3. Manual test scripts (tick each; record phone, OS and app version)

**1 — Shell and bridge.** Install the internal build. The site loads inside the app. In a remote debugger (debug build only) `window.Capacitor.isNativePlatform()` is true and `navigator.userAgent` contains `LPPApp/<version> (<platform>)`. `window.Capacitor.Plugins.PushNotifications` exists. *If the plugins are missing, the bridge does nothing and push/links/lock will not work: stop and report.*

**2 — Offline.** Airplane mode: a banner says "You're offline. Some private account features are temporarily unavailable." Turning the network back on removes it and refreshes. Cold-start while offline: the local offline page appears; "Try again" reloads.

**3 — Version.** In Control Center set the minimum above the installed version: the app shows the update screen and cannot sign in or register; the Update button opens the store listing only. Lower the minimum again; the app works. Set only the recommended version: a dismissible banner.

**4 — Sign-in and device.** Sign in with e-mail code. *Account Settings → Your devices* lists this phone. *Sign out* ends the session and returns to the sign-in page. Sign in on a second phone; remove the first from the second: the first is signed out on its next request.

**5 — Notifications.** *Turn on notifications* → phone permission appears only now. *Send a test* arrives. Create a real proposal update (admin test data): a **private** notification arrives with generic text. Change to Minimal and Off; confirm each. Quiet hours: set them over the current time and confirm a normal notice is held while an urgent one is not. Turn notifications off at the phone: the next send reports an invalid token and the device shows "dead token".

**6 — Deep links.** From Notes / a message: open `/my-proposals` (opens the app on that page), a proposal you own, a proposal you do **not** own (must show not found), a deleted code, and the same links signed out (sign in, then it continues). Tap a notification: lands on the right page. Android: `adb shell pm get-app-links` is *verified*.

**7 — Device lock.** Turn on the app lock (the phone asks you to authenticate first). Background the app 30+ seconds, return: the lock appears; cancel and use *Can't unlock? Sign out of this device*; sign in again.

**8 — Privacy screen.** On documents, proposals and verification pages, take a screenshot and open the app switcher: content is hidden. On the dashboard it is not.

**9 — Photos.** Upload a profile photo from the camera and from the library. Only the chosen photo is uploaded; the library is not scanned. No camera/storage permission is requested on Android.

**10 — Accessibility.** TalkBack / VoiceOver read the update, lock and offline screens; touch targets are at least 44 px; the app respects large text and reduced motion.

**11 — Family.** Sign in as a family member: family routes work; a family link opens the family page; an applicant link answers not found; family devices appear under *Security*.

**12 — Payments.** Start a membership checkout from the app: refused ("Purchases are not available in the app."). The website checkout is unaffected.

**13 — Deletion.** *Account Settings → Request Account Deletion* with the e-mail code; the request appears in the privacy workflow; `/delete-account` is public.

## 4. End-to-end journey (brief §56)

Install → register → e-mail code → complete profile → submit → verification → admin review → active → match → proposal → push → deep link → view → respond → mutual interest → contact permission → meeting → follow-up → membership (if enabled) → support → security centre → account deletion. Run it on web, PWA, Android and iOS; record the result per platform in `MOBILE_PRODUCTION_READINESS.md`. **None of these runs has been done yet.**

## 5. Release gates

A release may go to production only when: all automated checks are green; scripts 1–13 pass on the device matrix; the crash-free rate of the closed test is acceptable; the Data safety / privacy forms match `GOOGLE_PLAY_STORE_CHECKLIST.md`; and a human has reviewed the privacy policy and `/delete-account`.

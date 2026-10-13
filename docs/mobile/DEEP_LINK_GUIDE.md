# Deep link guide (STEP 37)

A deep link is a route, never a permission. Opening one in the app does exactly what typing the same address in a browser would do: the page checks who is signed in and what they may see.

## Approved routes

Defined once in `src/lib/mobile/deep-link.ts` (`ALLOWED_LINKS`) and used by the resolver, the iOS association file and (checked by a test) the Android manifest:

* Applicant: `/dashboard`, `/dashboard/proposals/{code}`, `/dashboard/notifications`, `/dashboard/documents`, `/dashboard/membership`, `/dashboard/profile/edit`, `/dashboard/journey`, `/dashboard/referrals`, `/dashboard/feedback`, `/dashboard/settings/notifications`, `/my-proposals`, `/my-verification`, `/my-status`, `/my-notifications`, `/account-settings`, `/report-concern`.
* Family: `/family/dashboard`, `/family/proposals`, `/family/meetings`, `/family/documents`, `/family/communications`, `/family/security`.

The brief's examples `/proposals/{id}` and `/meetings/{id}` correspond to `/dashboard/proposals/{code}` (meetings live inside proposals). A family member's proposal link resolves to the list, not a record.

Never listed: anything under `/admin`, `/api`, files, tokens or sign-in secrets.

## What is refused

The query string is dropped, and a link whose query contains a secret-looking name (`token`, `password`, `key`, `otp`, `code`, `auth`, `session`, `phone`, `email`, `mobile`…) or a long opaque value is refused. So are: another host, `http`, user-info in the address, `//` or `\` tricks, `..` (also encoded), control characters, over-long values, unknown routes, and an id that is not a plain code.

## Resolving

`POST /api/mobile/deep-link/resolve { "url": "…" }`

| Situation | Answer |
|---|---|
| Valid route, signed in, right kind of account, record is theirs | `200 { allowed: true, path }` |
| Valid route, not signed in (this includes an expired or revoked session and a restricted account, which the website also treats as signed out) | `401 { allowed: false, reason: "SIGN_IN_REQUIRED", path: "/login" }` (family routes: `/family/dashboard`, which shows the family sign-in). The app signs in, then asks again |
| Anything else (unknown route, wrong host, secret in the link, wrong kind of account, a record that is missing or is someone else's) | `404 { allowed: false, reason: "NOT_FOUND" }` — always the same, so a link reveals nothing |
| `mobile.deep_links.enabled` off | `404 { reason: "DISABLED" }` |

Each attempt is recorded as `MOBILE_DEEP_LINK_OPENED` (outcome `ALLOWED` or `REFUSED`, with a reason word and the route pattern, never the full link). Control Center → Mobile apps shows the counts.

## Notification taps

A push carries only an app path. The app sends that path through the same resolver before navigating.

## Android App Links

* `/.well-known/assetlinks.json` is served by the website. It is an empty list until `ANDROID_SHA256_CERT_FINGERPRINTS` is set, then it names `ANDROID_PACKAGE_ID` and every fingerprint (upload key **and** Play App Signing key).
* The manifest intent filter (`autoVerify`) lists the exact routes above on host `${appHost}` (`LPP_APP_HOST`).
* Verify: `curl https://<host>/.well-known/assetlinks.json` and, on a phone, `adb shell pm get-app-links <package id>` (state should be *verified*). Test a link with `adb shell am start -a android.intent.action.VIEW -d "https://<host>/my-proposals"`.

## iOS Universal Links

* `/.well-known/apple-app-site-association` is served with no redirect as JSON. Empty until `APPLE_TEAM_ID` is set, then `<TEAMID>.<bundle id>` and the approved routes only (no wildcard, no admin or API).
* The `applinks:<host>` entitlement is written by `mobile/scripts/configure-ios.mjs`.
* Verify: `curl -i https://<host>/.well-known/apple-app-site-association`, then tap a link in Notes or Messages on a TestFlight install. (Apple caches the file; reinstall the app after changing it.)

## Test matrix (`MOBILE_TESTING_GUIDE.md`)

Valid link; signed out; another person's proposal code; deleted or unknown code; expired session; restricted account; wrong account kind (family opening an applicant route and the reverse); parameter tampering (`?token=…`); a link on another host; double-encoded traversal. The automated tests cover the logic of every row (`mobile-rules.test.ts`, `mobile-flow.test.ts`); the device tests prove the OS hands the link to the app.

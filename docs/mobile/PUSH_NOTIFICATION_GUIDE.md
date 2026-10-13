# Push notification guide (STEP 37)

## How it works

1. Something happens (a proposal update, a meeting, a verification result…). The existing `sendNotification()` creates the in-app notification, exactly as before.
2. If `mobile.push.enabled`, `mobile.app.enabled` and `notifications.enabled` are on, the server mirrors that notification to the recipient's registered phones (`src/lib/mobile/push-service.ts`). It does this **after** the in-app notification exists and never changes it: a push failure cannot affect the workflow.
3. For each device the server applies, in order: the account's restrictions → the person's proposal/meeting preference → quiet hours (not for high/urgent) → the lock-screen display mode (private by default) → a cap of 20 per device per hour → the provider.
4. FCM (Android) or APNs (iPhone) delivers a generic message. Tapping it opens the app, which asks the server whether the person may open the path in the data part (`/api/mobile/deep-link/resolve`).

Marketing messages are never pushed. Administrators have no devices; there is no admin push.

## The provider abstraction

`PushProvider` (`src/lib/mobile/push/types.ts`): `isConfigured()`, `validateToken()`, `send()`, `sendBatch()`. A provider only talks to one push service; it never decides who gets what. Registration, unregistration, invalid-token removal and delivery history are done by the device and push services:

| Brief's method | Where |
|---|---|
| registerDevice / unregisterDevice | `device-service.ts` (`registerDevice`, `registerPushToken`, `unregisterPushToken`, `removeDevice`) |
| sendNotification / sendBatch | `push-service.ts` (`dispatchPushForNotification`, `sendTestPush`) over `provider.send` / `sendBatch` |
| validateToken | `provider.validateToken` at registration |
| removeInvalidToken | `markTokenInvalid` (when a provider says the token is dead) |
| getDeliveryStatus | `MobilePushDelivery` rows and the Control Center summary |

Only FCM HTTP v1 and APNs token-based sending are implemented. There is no SDK: requests are plain HTTPS / HTTP/2 with short-lived signed JWTs.

## Event coverage

Every notification type already created by the platform reaches the phone, filtered by the rules above, so the brief's list is covered by the existing events (`PROPOSAL_*`, `MEETING_*`, `VERIFICATION_*`, `FOLLOWUP_*`, `CONTACT_*`, membership and payment notices, security notices). Only notices with a category that is not marketing and not low-priority noise are pushed. Nothing here adds new business events.

## Display modes

| Mode | Title | Body |
|---|---|---|
| Private (default) | Life Partner Pro | You have a new update in Life Partner Pro. |
| Full | the platform's short update title | the platform's short generic text |
| Minimal | Life Partner Pro | Open the app. |
| Off | nothing is sent | |

The account's choice is in *Account Settings → Your devices & notifications*; each device can override it.

## Setting it up

1. Firebase project, Android app, service account → server variables `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` (Vercel). `google-services.json` goes to the Android build as a CI secret (`ANDROID_RELEASE_GUIDE.md` §3).
2. Apple: push-enabled App ID, an APNs key → `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_ENVIRONMENT` (`IOS_RELEASE_GUIDE.md` §2).
3. Control Center → Feature flags → switch `mobile.push.enabled` on (it is sensitive: enabling in production needs approval when that policy is on).
4. On a phone: Account Settings → Your devices & notifications → *Turn on notifications* → *Send a test*.

Until the provider variables are set, notifications are recorded as *skipped: provider_not_configured*; nothing is queued and nothing fails.

## Operating it

Control Center → Mobile apps → Push shows whether each provider is configured, the last 24 hours (sent / skipped / failed / invalid token), the most common reasons for skipping, and per-device test and remove actions (a test sends one fixed generic message and is audited; there is no broadcast and no custom text). A dead token is removed automatically; a device with a dead token shows under "Dead token".

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Skipped: `provider_not_configured` | FCM/APNs variables missing on the server |
| Skipped: `quiet_hours` / `preference_off` / `display_off` / `rate_limited` | the person's own settings or the cap; expected |
| Invalid token | app reinstalled, token expired, or wrong Firebase project / APNs environment (sandbox vs production) |
| Android shows nothing | notifications blocked in phone settings, or `google-services.json` missing in the build |
| iPhone never registers | Push capability missing, wrong bundle id, or `APNS_ENVIRONMENT` does not match the build |

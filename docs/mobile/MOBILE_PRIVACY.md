# Mobile privacy (STEP 37)

The apps do not create a second privacy system. Consent, communication preferences, data export, correction, restriction and deletion are the website's own (STEP 13 and STEP 23), shown inside the app because the app shows the site.

## What the app adds

| Data | Where | Why | Removed when |
|---|---|---|---|
| Random installation id (not a secret, identifies no person) | the phone (app preferences) and `MobileDevice` | tell one installed app from another so a device can be listed and removed | the device is removed or the account is deleted |
| Device label and versions (for example "Pixel 7", app 1.2.0, Android 14) | `MobileDevice` | show "Your devices", apply the minimum app version | same |
| Push token | `MobileDevice`, encrypted | send notifications | notifications turned off, device removed, token reported dead, account deleted |
| Notification display mode and device-lock choice | `NotificationPreference.pushDisplayMode`, `MobileDevice` | the person's own choices | account deleted |
| Delivery record (status and reason word, no message text) | `MobilePushDelivery` | show delivery health | deleted with the device |
| Anonymous usage counts | `MobileEventCounter` | improve the app | aggregates only; no person |

The app asks for **no** location, contacts, microphone or Bluetooth. Camera and photos use the system picker, so only the photo the person chooses is shared with the page. Nothing is uploaded automatically and the photo library is never scanned.

## Notifications

Lock-screen text is chosen by the person: **Private** (default: "You have a new update in Life Partner Pro."), **Full** (the platform's own short update title), **Minimal** ("Open the app.") or **Off**. A notification never contains a name, phone number, proposal detail or document name; the hidden data part only holds a notification id and an in-app path. Marketing messages are never pushed. Quiet hours, the person's proposal/meeting preferences, restrictions on the account and a cap of 20 pushes per device per hour are applied before sending. Asking for the phone's permission happens only after the person taps "Turn on notifications" on a screen that explains why.

Google (FCM) and Apple (APNs) deliver the notification, so they receive the device token and the generic text. This is disclosed in the store data forms.

## Family members

A family member's device belongs to the family member's own session. Their notifications are limited to what they are allowed to see (STEP 22), and a family member has no applicant-level preferences: the display mode is per device.

## Consent and communication preferences

Push honours the same in-app notification preferences as the website; it does not create a separate consent. Marketing consent is unaffected and never implied by registering a device.

## Account deletion

Account Settings → **Request Account Deletion** (inside the app and on the website) starts the STEP 13 workflow: identity confirmation by e-mailed code, a review, a cooling-off period, then deletion or anonymisation. The app never deletes a database row itself. Devices belong to the account and are removed with it. The public page `/delete-account` describes this for the store listings and for people who cannot sign in (they use the contact form with the "Privacy request" topic).

## Data export and privacy requests

Unchanged: Account Settings → Download my data, and the privacy centre.

## Analytics

Off unless `MOBILE_ANALYTICS_ENABLED=true`. When on, only a fixed list of event names is counted per day, platform and app version. No identifier, no content, no IP address, no free text. Do Not Track / Global Privacy Control requests are honoured.

## Crash reports

Reports carry the platform, app and OS version, an error name and an opaque digest, and the page path without its query string. They carry no profile, phone number, e-mail or document content.

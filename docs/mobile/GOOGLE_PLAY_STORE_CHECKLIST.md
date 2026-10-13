# Google Play store checklist (STEP 37)

Tick items in the Play Console as you go. Items marked **owner** need the account owner; Claude cannot create or control a Play Console account.

## 1. Store listing text (drafts: review and adapt)

**App name:** Life Partner Pro

**Short description (80 characters at most):**
`Private, family-friendly matrimonial matchmaking with human review.`

**Full description (4,000 characters at most):**

> Life Partner Pro is a private matrimonial platform for individuals and families who want a structured, respectful way to look for a life partner.
>
> • Private profiles. There is no public directory and no browsing of strangers' profiles. Information is visible only to the people and staff who need it.
> • Structured preferences. You describe yourself and what matters to you in a guided profile, and say which requirements are essential.
> • Verification. Contact details are confirmed and profiles are reviewed by our team before they are used. Verification lowers risk but cannot remove it.
> • Admin-assisted matchmaking. Our team reviews suggested matches and introduces compatible proposals. Matching is guidance, not a promise.
> • Family participation. Invite family members and choose what each of them may see and do.
> • Consent-based contact. Phone numbers and other contact details are shared only after mutual interest and an approved permission step.
> • Proposals and meetings. Review proposals, respond, and arrange meetings with reminders and follow-ups.
> • Communication controls. Choose how you are contacted and what a notification may show on your lock screen. Quiet hours and your preferences are respected.
> • Your data, your choice. Download your information or ask for your account to be deleted from inside the app.
>
> Life Partner Pro is a matrimonial platform for adults. It is not a dating app, and we cannot guarantee a match or a marriage.

Rules for any change to this text: no "guaranteed", "100%", "perfect match", "dating", "swipe", no invented numbers or testimonials.

## 2. URLs (all public, no sign-in needed)

| Field | Value |
|---|---|
| Privacy policy | `https://<site>/privacy-policy` |
| Terms | `https://<site>/terms` |
| Support / contact | `https://<site>/support` and `https://<site>/contact` |
| Website | `https://<site>/` |
| Account deletion (App content → Data safety → Data deletion) | `https://<site>/delete-account` |

## 3. Graphics (use REAL screenshots; never mock-ups)

| Asset | Requirement (check the console for the current rules) | Status |
|---|---|---|
| App icon | 512 × 512 PNG, 32-bit, no transparency needed. Source: `public/icons/icon-512.png` / `src/app/icon.png` | file exists; **owner** uploads |
| Feature graphic | 1024 × 500 PNG or JPG | **to be designed** |
| Phone screenshots | at least 2, up to 8; 16:9 or 9:16, each side 320–3840 px | **to be captured from a real build** (see below) |
| 7-inch / 10-inch tablet screenshots | recommended if you want to be listed as tablet-ready | optional |
| Short promotional video | optional | optional |

Capture screenshots from a **production-like account with a made-up test profile** (never a real applicant), on a phone, at the real UI. Good screens: the dashboard, the guided profile, a proposal summary (test data), notification settings ("Your devices & notifications"), and Security & Sessions. Remove any real name, number or photo.

## 4. App content declarations

| Declaration | Answer for this app |
|---|---|
| Ads | No ads |
| App access | Restricted: a reviewer needs a test account. **Owner** creates one test applicant (a genuine registration verified by an administrator) and enters its Profile ID and how to receive the sign-in code. Do not invent credentials and do not use a real person's data |
| Target audience | Adults only (18+). Not directed at children. Whether a lower age limit applies in a country is a **legal review** item (STEP 23 jurisdiction configuration); this step added no hard-coded age rule |
| Content rating (IARC questionnaire) | Answer truthfully: user-to-user communication is staff-mediated, no public user-generated content, no gambling, no violence. The result is set by the questionnaire, not by us |
| Data safety | Section 5 below |
| Financial features | None in the app today (see Billing) |
| Government / health / news | No |
| Permissions | `POST_NOTIFICATIONS` (explained just before it is asked) and `INTERNET`. Camera/photos use the system picker, so no storage or camera permission is declared |

## 5. Data safety (draft inventory: verify against production before submitting)

Encrypted in transit: **yes** (HTTPS only; plain-text traffic is disabled in the app). Users can request deletion: **yes** (Account Settings and `/delete-account`). Data processed on the server stays under the privacy policy; the app itself keeps no copy beyond the web view's normal cache and cookies.

| Data | Collected | Shared | Purpose | Optional? | At rest | Retention / deletion |
|---|---|---|---|---|---|---|
| Name | Yes | With staff and, only after consent, the other family | Profile, matchmaking | Required | Database provider encryption | Privacy policy retention; deleted/anonymised on request |
| E-mail address | Yes | Service providers that send sign-in codes and notices | Account, sign-in codes, notices | Required | as above | as above |
| Phone / WhatsApp number | Yes | Shared with the other party only after mutual interest and approval; message providers when configured | Contact, verification | Required (phone) | as above | as above |
| Profile information (age, location, religion, marital status, etc.) | Yes | Shown to matched parties only as the profile rules allow | Matchmaking | Required for matching | as above | as above |
| Photos | Yes | Only as the photo rules allow | Profile | Optional | Encrypted (AES-256-GCM) in file storage; served only through permission-checked routes, never as a public file link | as above |
| Education, profession, income range | Yes | As profile rules allow | Matchmaking | Optional/required per field | as above | as above |
| Family information | Yes | Only with the family members the applicant invites and permits | Family participation | Optional | as above | as above |
| Partner preferences | Yes | Used by the matching engine and staff | Matchmaking | Required for matching | as above | as above |
| Verification information and documents | Yes | Staff reviewers only | Verification | Optional (as policy requires) | Encrypted (AES-256-GCM) in file storage; permission-checked access only | Retention policy; deleted on request |
| Payment information | Bank-transfer references and invoices; no card numbers are stored | Payment provider when configured | Membership | Optional | Database provider encryption | Accounting retention |
| Device information (install id, app/OS version, model label) | Yes | No | Device list, version policy, notifications | Automatic when the app is used | as above | Removed when the device is removed or the account is deleted |
| Push tokens | Yes (encrypted) | Sent to Google (FCM) / Apple (APNs) with a generic message | Notifications | Optional (permission) | AES-256-GCM | Deleted when notifications are turned off, the device is removed, or the account is deleted |
| App usage counts | Aggregate counts of fixed event names, no identifier | No | Improving the app | Off unless enabled | n/a | Aggregates only |
| Support information | Yes | Staff | Support | Optional | as above | Retention policy |

Never describe a category as "not collected" if it appears in this table.

## 6. Billing

The app does **not** sell memberships: `mobile.payments.enabled` is off, and the server refuses a checkout started from the app. If you later sell digital memberships inside the Android app, Google Play's billing policy requires Play Billing (or an approved alternative in your region). That is a product and legal decision plus a new build, not a flag flip. The server remains the only source of entitlements either way.

## 7. Pre-launch checklist

- [ ] Release bundle built by CI with the upload key (`require_signing` ticked) and installed from the internal-test link
- [ ] `MOBILE_TESTING_GUIDE.md` passed on at least one current and one older Android phone
- [ ] `https://<site>/.well-known/assetlinks.json` lists the package and **both** certificate fingerprints; links open the app
- [ ] Firebase configured, `mobile.push.enabled` on, a test notification received, lock-screen text is generic
- [ ] Version policy set (minimum/recommended/latest) and release recorded in Control Center
- [ ] Privacy policy and `/delete-account` reviewed by a human; `LEGAL_PAGES_REVIEWED=true` only after that
- [ ] Data safety form matches section 5 and production reality
- [ ] Reviewer test account created (owner), instructions entered
- [ ] Real screenshots, icon and feature graphic uploaded
- [ ] Crash/ANR rate acceptable in pre-launch reports

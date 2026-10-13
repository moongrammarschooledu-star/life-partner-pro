# Apple App Store checklist (STEP 37)

Items marked **owner** need the Apple Developer account holder. Claude cannot create or control App Store Connect.

## 1. App information (drafts)

| Field | Draft |
|---|---|
| Name | Life Partner Pro |
| Subtitle (30 characters) | `Private matrimonial platform` |
| Promotional text | `Private, family-friendly matchmaking with human review and consent-based contact sharing.` |
| Keywords (100 characters, comma separated) | `matrimonial,marriage,family,proposal,verified,private,matchmaking,rishta,nikah` |
| Category | Lifestyle (primary), Social Networking (secondary) is **not** advised: the app has no social feed |
| Description | The same text as the Play listing (`GOOGLE_PLAY_STORE_CHECKLIST.md` §1): no guarantees, no "dating", no invented numbers |
| Support URL | `https://<site>/support` |
| Marketing URL | `https://<site>/` |
| Privacy policy URL | `https://<site>/privacy-policy` |
| Copyright | the account holder's legal name |

## 2. Screenshots and icon

The 1024 × 1024 icon is generated (`mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset`). Screenshots must be **real captures** from a build with a made-up test profile. Required sizes change; App Store Connect lists the current ones for the largest iPhone and iPad classes (for example 6.9-inch iPhone and 13-inch iPad if you support iPad). Remove any real person's name, number or photo.

## 3. App Privacy ("nutrition label")

Declare the same data as `GOOGLE_PLAY_STORE_CHECKLIST.md` §5. Everything collected is **linked to the person's identity** and used for **app functionality**; none is used for tracking or advertising, and the app contains no third-party advertising or analytics SDK. Tick: Contact Info (name, e-mail, phone), User Content (photos, profile information, support messages), Identifiers (device id = the random install id), Usage Data only if `MOBILE_ANALYTICS_ENABLED` is turned on (aggregate counts), Purchases only if you sell memberships in the app (not today).

## 4. Age rating

Answer the questionnaire truthfully (no gambling, no violence; user-to-user communication is staff-mediated). It is a matrimonial platform for adults; do not select a child-directed category. Any country-specific minimum age is a legal-review item (STEP 23).

## 5. Review information

* **Sign-in required: yes.** Give a test account: the owner creates a dedicated test applicant (a real registration verified by an administrator) and enters its Profile ID and how the reviewer receives the sign-in code. Do not invent credentials and do not use a real person's data.
* **Notes for the reviewer** (draft): "Life Partner Pro is a private matrimonial platform for individuals and families. The app shows the platform's applicant and family areas. Beyond the website it adds push notifications with privacy modes, Universal Links to specific app routes, an optional Face ID lock, hiding sensitive screens from screenshots and the app switcher, and a list of signed-in devices that can be removed. Account deletion: Account Settings → Delete Account → Request Account Deletion. Notifications never include names, phone numbers or proposal details."
* Contact details of a person who can answer review questions (owner).

## 6. Guideline checklist

| Guideline | How the app meets it | Status |
|---|---|---|
| 2.1 App completeness | production backend; reviewer account; no placeholder content | needs a run on a real device |
| 4.2 Minimum functionality | native additions above; the main risk for a wrapper | owner decision on wording; cannot be guaranteed |
| 5.1.1(i) Privacy policy | linked in the app and in Connect | ready |
| 5.1.1(v) Account deletion in the app | Account Settings flow + `/delete-account` | ready |
| 5.1.2 Data use | no tracking; no third-party advertising | ready |
| 4.8 Sign in with Apple | not required: no third-party social login | n/a |
| 3.1.1 In-app purchase | the app does not sell memberships; the server refuses an in-app checkout | ready; revisit if that changes |
| 1.2 User-generated content | no public content; staff-mediated communication; report-a-concern route | review wording |
| 5.1.1(ii) Permission strings | camera, photo library, Face ID: each explains why | ready |
| Push notifications (4.5.4) | opt-in, just-in-time, not used for marketing | ready |

## 7. Pre-submission

- [ ] Signed build installed from TestFlight and `MOBILE_TESTING_GUIDE.md` passed on a current and an older iPhone
- [ ] Universal Links open the app; a link to someone else's record opens "not found"
- [ ] APNs key configured on the server; a test notification arrives; lock-screen text is generic
- [ ] Export compliance: the app uses only the standard HTTPS provided by the OS (`ITSAppUsesNonExemptEncryption` is `false`)
- [ ] Privacy labels match the checklist; screenshots are real

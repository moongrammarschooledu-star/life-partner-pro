# Applicant Onboarding (STEP 35)

This describes the onboarding that exists today and what STEP 35 changed. It does not describe the "create account, then verify, then start the profile" order from the brief, because the platform does not work that way: authentication was **not** duplicated or rewritten.

## The real flow

1. **Visit and choose to register.** `/register` (also reachable from the home page, navigation, footer and every call-to-action).
2. **Fill the wizard (8 steps).** Basic information → Contact → Education & Profession → Family → Lifestyle → Partner requirements → Photo → Review & Submit. Nothing leaves the browser until the last step.
3. **Submit.** `POST /api/register` validates server-side, stores the optional photo encrypted, creates the profile with a **Profile ID** (for example `LPP-000123`) and starts a signed session for that browser, so the applicant lands on their status page without a second sign-in.
4. **Contact verification.** E-mail and phone are confirmed with one-time codes (`/api/verify/*`).
5. **Review and verification.** A person on the team reviews the profile; identity, education or employment documents are requested only where the verification policy requires them. Statuses: not verified, pending, under review, verified, rejected, expired, re-verification required.
6. **Activation.** The profile moves through the profile statuses (new → under review → verified → active → matching …). A registered account is **not** treated as an active applicant: "Active" is its own, later stage (also in the funnel report).
7. **Coming back.** Applicants sign in at `/my-status` with their Profile ID and e-mail address; a one-time code is e-mailed (STEP 33). There is no password.

Family members take part only by invitation from the applicant, with their own sign-in (`/family/*`).

## What STEP 35 added to the wizard

| Item | Detail |
|---|---|
| Privacy statement | Step 1 opens with "Your personal information is not publicly displayed. Each step asks only for what it needs, and optional details are marked as optional." |
| Live completion | A progress bar with a percentage under the step list, on every step (it used to appear only on the review step). It reuses the existing wizard estimator `lib/profile-completion.ts`; no second scoring rule was added |
| Privacy notes at sensitive steps | Family ("used for family-friendly matching where authorised, never shown publicly"), Income ("optional; used only where authorised and shown only according to privacy permissions"), Photo ("private; shown only to people the privacy rules allow"). The Contact step already carried its own note. English and Urdu |
| Optional sections | Already present (`OptionalSection`, "More details (optional)") on five steps; unchanged |

Documents are not collected during registration, so there is no document note in the wizard; documents are requested later and are private to authorised staff.

## Save and resume

The draft is saved in the browser's `localStorage` on the same device and offered again on the next visit ("Resume draft" / "Start over"). Two honest limits: it is **device-only** (it does not follow the applicant to another phone) and it holds the answers entered so far on that device until it is discarded or the form is submitted. This is a privacy trade-off for a form with personal details; shared computers should use "Start over" before leaving.

## Validation and error recovery

- Required fields are validated per step in the browser; the server validates again with the same rules and answers a generic error for anything malformed (no detail that would help a bot).
- A honeypot field and a rate limit (5 submissions per minute per client) protect `/api/register`. A refused or failed submit shows the server's message (or "Something went wrong. Please try again.") and **keeps the draft**: it is removed only after a successful submit.
- If the browser or network fails during submit, the draft is still on the device and can be resumed.
- Registration can be paused by the administrators' switches (`registrations`, `profileSubmissions`, flag `registrations.enabled`); the form then reports it is unavailable instead of failing silently.

## Consent

Before submitting, the applicant ticks: the information is accurate; storage of the profile; review by the administrators; and (optionally) permission to be contacted. Marketing consent is separate and optional (STEP 25/29). The privacy policy and terms open from the review step.

## Reminders

Engagement reminders (STEP 30) use the existing notification preferences, quiet hours, frequency limits and suppression: incomplete profile, verification, review, missing photo, proposal response. They are off or on according to the STEP 30 flags and never use manipulative urgency. STEP 35 adds no new reminders.

## Funnel

Admin → **Public Website** shows the funnel: visitors → page views → call-to-action clicks → registration started (anonymous, counted only when `marketing.site_events.enabled` is on) and registered → profile completed → submitted → verification → active (existing STEP 30 events). The two halves use different sources, so the numbers are for trends, not exact conversion rates.

## Known gaps

- No self-service password reset for family accounts (admin-only; the public pages say so).
- Registration does not collect UTM/campaign data on the main site; landing pages (`/lp/…`) do, through STEP 29.
- No CAPTCHA/Turnstile (needs an owner-created site key); honeypot, rate limit and server validation are in place.

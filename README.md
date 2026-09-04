# Life Partner Pro

**Finding the Right Life Partner, With Trust.**

A private, admin-managed matrimonial matchmaking platform. Applicants submit a detailed profile through a secure
multi-step registration form; nothing they submit is ever publicly visible or searchable. Authorized administrators
review, verify, and manually match profiles using a transparent, weighted compatibility score, then manage the full
proposal → contact-sharing → meeting → finalization workflow.

This build implements the platform's core matchmaking workflow end-to-end (see "What's implemented" below). Several
items from the original specification are intentionally deferred — see "Deferred / extension points."

## Tech stack

- **Next.js 16 (App Router) + React 19 + TypeScript**
- **Tailwind CSS v4** (light/dark mode via a `dark` class, toggleable and persisted per-browser)
- **Prisma ORM + PostgreSQL** (works with any Postgres — Neon, Vercel Postgres, Supabase, RDS, or local)
- **NextAuth.js v5 (Auth.js)**, credentials provider, JWT sessions, role claims
- **bcryptjs** for password hashing, **sharp** for server-side image re-encoding, **zod** for validation

## Getting started

Requires a reachable Postgres database (a free [Neon](https://neon.tech) branch or `docker run postgres` both work
fine for local dev).

```bash
npm install
cp .env.example .env      # then set DATABASE_URL to your postgres connection string,
                           # and NEXTAUTH_SECRET to a real random value
npm run db:push           # creates the schema in that database
npm run db:seed           # creates the super admin login + 20 demo profiles
npm run dev
```

Visit `http://localhost:3000` for the public site, or `http://localhost:3000/admin/login` for the admin dashboard.

### Seeded admin login

The seed script prints a generated admin login to the console. By default:

- **Email:** `admin@lifepartnerpro.local`
- **Password:** `ChangeMe123!` (or the value of `SEED_ADMIN_PASSWORD` in your `.env`)

**Change this password before using the app with real data.** There is no first-run forced password change flow in
this build — create a new `AdminUser` with a strong password via Prisma Studio (`npm run db:studio`) or a short
script, then deactivate or delete the seeded account.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string. |
| `NEXTAUTH_SECRET` | Signs admin session JWTs. Generate with `openssl rand -base64 32`. |
| `SEED_ADMIN_PASSWORD` | Optional — overrides the seeded super admin's password. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob token for photo uploads. Auto-set when you add a Blob store under the project's Storage tab. |

No third-party API keys are required or referenced anywhere in the codebase (see "Notifications" below).

## What's implemented

- **Public site:** landing page, privacy policy, terms, an 8-step registration wizard (basic info → contact →
  education/profession → family → lifestyle → partner preferences → photo → review & consent), and a self-service
  "request an update" flow that requires admin approval before changes go live.
- **Registration wizard, in depth:** age is auto-calculated (read-only) from date of birth; height supports a
  feet/inches ⇄ centimeters toggle; Divorced/Widowed/Separated reveals optional children fields; the
  Education/Career step shows different sub-fields for Job vs Business vs Student vs Not Working; Country is a
  dropdown and City is a searchable (native `<datalist>`) field with curated suggestions; partner preferences
  capture a Must-Have/Preferred/Flexible priority for age/location/profession plus a location-scope selector
  (captured for future matching-engine use — see Deferred below); the photo step offers rotate, a private-photo
  notice, and a lightweight non-biometric quality check (dimensions + a blur heuristic — never facial recognition or
  attribute inference); the review step masks phone/email, shows a live profile-completion percentage with
  suggestions, and lets you jump back into any section to edit it; consent is four distinct checkboxes (three
  required, one — contact/communication consent — genuinely optional) instead of one blanket checkbox; the whole
  form autosaves to the browser (`localStorage`) and offers to resume a draft after a refresh or closed tab; a
  hidden honeypot field plus the existing rate limiter give baseline anti-spam protection; and a submission with a
  phone number or email already on file is rejected as a possible duplicate. An English | اردو toggle translates the
  wizard's own labels, headings, buttons, and consent text (never the data you type, and never the admin dashboard).
- **Post-submission status, without accounts:** submitting a profile sets a signed, httpOnly cookie (HMAC'd with
  `NEXTAUTH_SECRET`, never a guessable URL/ID) that lets that browser revisit `/my-status` for a private view of
  Profile Status / Completion / Verification / Matchmaking Status — never other applicants' data. A device without
  the cookie (or a different browser) can still get in with Profile ID + registered email, the same identity check
  the update-request flow already used.
- **Privacy by design:** contact information (phone/WhatsApp/email) is never included in any list or detail
  response by default. It is only ever returned by one explicit "reveal contact" endpoint, which is permission-gated
  and writes an audit log entry every time it's called. Photos are stored in Vercel Blob; the raw blob URL is never
  sent to the browser — it's only ever fetched server-side and streamed back through an authenticated route.
- **Admin dashboard:** a greeting header with the live date, KPI cards (Total/New/Verified/Active Profiles, Pending
  Review, Active Proposals, Meetings, Successful Matches) with real week-over-week trend arrows computed from
  registration and verification event counts (never fabricated — metrics with no defensible historical basis show a
  plain number instead of a misleading trend), a period-selectable (Today/7D/30D/3M/6M/1Y) male/female registration
  chart, a Matching Center summary row with a shortcut into the Matching Center, a "Today's Priorities" action list,
  and distribution breakdowns by gender, age, city, profession, and education — all computed from the database, no
  mock data.
- **Matching Center** (`/admin/matching`): the primary matchmaking workspace — search/select any profile, "Find Best
  Matches" against admin-configurable weights/thresholds/hard-requirements, sort (highest/lowest/newest/same
  city/area/age·education·profession-closest/most-complete/recently-active) and filter (minimum score, city,
  education, profession, age range, marital status, family type, religion, minimum profile completeness,
  verified/active-only) the ranked results, then open a full comparison panel per candidate showing the mutual
  **A→B / B→A / blended** compatibility, a per-category breakdown (percentage bar **and** a ✓ compatible / ⚠ partial
  / ✕ incompatible / — unknown indicator — missing data is never shown as a penalty), an admin recommendation +
  private note ("Save Match Decision"), and proposal creation with a priority level. By default only Verified +
  Active profiles are eligible candidates (an "include all eligible statuses" toggle widens this); the default
  ranking order is mutual score → verification → recent activity → profile completeness, matching a documented
  ranking priority rather than raw score alone.
- **Global search & notifications:** a topbar search (name / Profile ID / phone / city / profession) and a
  computed notifications panel (profiles awaiting verification, follow-ups due, new high-compatibility matches —
  named with the actual profile-ID pairs and scores, linking straight to Match Analysis, not just a count —, recent
  proposal responses) — the notifications are assembled live from existing tables on every request, not a
  persisted/event-sourced notification log. The dashboard also shows a "Today's Best Matches" table, and Reports has
  a Matching Performance section (average match score, matches generated/reviewed, proposal conversion rates)
  explicit that a score is a suggestion for admin review, never a predictor of marriage success.
- **Profile management:** server-side paginated/filterable table (collapses to cards on mobile, filterable by
  gender/status/city/age/education/profession/marital status/verification), full detail view with edit, verify,
  status lifecycle, soft-delete/restore, internal notes, a browsable communication history, and a per-profile audit
  trail.
- **Matching engine** (`src/lib/matching.ts`, algorithm-versioned as `LPP-MATCH-v1.1`): compatibility is scored as
  *mutual* — every preference-based category (age, location, education, profession, income, marital status, height,
  family) checks both directions (does the candidate meet the seeker's stated preference, **and** does the seeker
  meet the candidate's), taking the weaker of the two, so a one-sided mismatch pulls the score down. Religious,
  lifestyle, and languages compatibility compare both profiles' actual attributes directly. Default weights (age
  15% / location 15% / education 10% / profession 10% / income 10% / marital status 10% / height 5% / family 10% /
  religious 10% / lifestyle 5% / languages 5%), match-tier thresholds, a per-category hard-requirement toggle, and a
  per-category **enable/disable** switch are all admin-configurable from Settings (Super Admin only) — the engine
  normalizes by whichever categories are actually enabled rather than assuming weights sum to exactly 100, so
  disabling a category (or any other weight customization) always yields a coherent 0-100 score. Each category is
  classified as Compatible / Partially Compatible / Incompatible / **Unknown** — missing data is never silently
  treated as a mismatch. A category marked as a hard requirement is flagged with a "Hard Requirement Not Met"
  warning; whether that also excludes the candidate from results outright is a separate, admin-configurable toggle
  (default: show them for review). Results are always framed as compatibility *suggestions*, never guaranteed
  matches — final decisions stay with the admin. Free-text partner requirements are shown to the admin for judgment
  but are never algorithmically scored. Core scoring logic has real unit tests (`npm test`, via Vitest) covering
  exact/partial/no-match scoring, flexible preferences, missing data, hard requirements, mutual-vs-naive-average
  compatibility, weight normalization, and ranking order.
- **Match workflow & history:** viewing a candidate in the comparison view persists a `Match` record (with
  per-category score columns, the mutual A→B/B→A directional scores, and the full breakdown) carrying its own status
  (`Suggested → Reviewed → Approved/Rejected → Proposal Created → Closed`) and an optional admin recommendation,
  independent of any proposal created from it. Every match is permanently auditable at `/admin/matches` (Match
  History) and `/admin/matches/[id]` (Match Analysis — a full-page, linkable/permalinkable view with the same
  breakdown, mutual scores, and decision controls as the Matching Center's comparison panel), and can be
  recalculated on demand — recalculating snapshots the prior score/breakdown before overwriting and reports what
  changed, so nothing is silently rewritten.
- **Proposals:** create a proposal (with a Low/Medium/High priority) between two profiles from the Matching Center
  or a profile's Matches tab (linked back to the `Match` it came from, snapshotting its score), then move it through
  Draft → Sent → Interested/Not Interested → Waiting → Meeting → Finalized → Closed, with a visible timeline. The
  proposal list is tabbed by status and shows match %, priority, and the creating admin.
- **Contact sharing:** approving contact sharing on a proposal requires picking which channels (phone/WhatsApp/email)
  are being shared and confirming that consent was received from both parties — never a single blanket checkbox —
  and every share records exactly which channels were approved.
- **Consent:** registration records four distinct, versioned consent flags (privacy, matchmaking use, contact
  sharing, terms) rather than one blanket checkbox — three (privacy, matchmaking, terms) are required at
  registration, contact-sharing consent is genuinely optional. A profile cannot be moved to `ACTIVE` status until
  the three required consents are on record.
- **Follow-up Center:** a tabbed view (Today / Upcoming / Overdue / Completed / Cancelled) with a direct "Add
  Follow-up" action (date, priority, notes) from any profile, independent of logging a communication.
- **Audit log:** every sensitive action (login, profile view/edit/delete, status changes, contact reveal/share,
  match creation/status change, proposal creation/status changes, note additions, update-request decisions) is
  recorded and browsable by an admin.
- **Role-based access control:** `SUPER_ADMIN` / `ADMIN` / `STAFF` / `VIEWER`, enforced both in `middleware.ts`
  (redirects unauthenticated requests) and again in every API route handler via `requireAdmin()` (the actual
  permission check — middleware alone is not sufficient authorization).
- **Demo data:** 20 fictional profiles (10 male, 10 female) with varied cities, education, professions, and partner
  preferences — see `prisma/seed.ts`. Clearly fictional; no real photos are included.

## Deferred / extension points

Per the original spec's own "Future Features" section, these are intentionally *not* implemented, but the code is
structured so they can be added without restructuring anything else:

- **Two-factor admin authentication** — `AdminUser.twoFactorEnabled` exists in the schema and a toggle appears in
  Settings, but it is not enforced at login.
- **CSV / Excel / PDF export** — no export logic is wired up.
- **Real email / SMS / WhatsApp delivery** — `src/lib/notifications.ts` defines a `NotificationService` interface
  with a console-only implementation. Swap in a real provider by implementing that interface; nothing else in the
  app should ever import a provider SDK directly.
- **Multi-language UI, native mobile apps, payments/subscriptions, CNIC/document verification** — not started.
- **Persisted/event-sourced notifications** — the topbar notifications panel is computed live from existing tables
  on every request rather than backed by a `Notification` table with write hooks on every triggering action.
- **Admin-side manual "Add Profile"** — profiles are still only created through the public registration wizard;
  there's no admin-facing manual-entry form.
- **Global search beyond profiles** — the topbar/Matching Center search covers profiles only (name / Profile ID /
  phone / city / profession), not proposals, matches, or follow-ups.
- **Full per-category Matching Center filters** — the filter bar covers minimum score, city, education, profession,
  age range, marital status, family type, religion, minimum completeness, and verified/active-only; height, income,
  lifestyle, and languages aren't yet broken out as their own dedicated filter controls.
- **Standalone cross-profile "Admin Notes" / "Communications" pages** — notes and communication history are
  per-profile (and per-match/per-proposal for notes), which already surfaces the same information without a
  separate aggregated view.
- **Saved filter presets and CSV import** — not implemented; CSV *export* already exists on the Reports page.
- **Real applicant accounts (password/OTP login)** — deliberately replaced by the signed-cookie `/my-status` flow
  above; there is no SMS/email OTP provider configured for this project.
- **Drag-to-crop photo editing** — the photo step supports rotate (90° steps) and replace; free-form cropping is not
  implemented.
- **A real CAPTCHA provider** (hCaptcha / Cloudflare Turnstile / reCAPTCHA) — registration anti-spam is a honeypot
  field plus the existing rate limiter; wiring a real provider needs an account and site/secret keys.
- **Matching-engine use of per-preference priorities** — the registration wizard captures a Must-Have/Preferred/
  Flexible priority for age/location/profession plus a location-scope choice (`PartnerPreference.agePriority` etc.),
  but `src/lib/matching.ts` does not yet weight scoring by them.
- **Exhaustive Urdu translation** — the wizard's labels, headings, buttons, and consent/error text are translated;
  dropdown *option* text and all stored data remain in their canonical English/enum form, matching the platform's
  own instruction to never auto-translate entered information.
- **A 4-value smoking/drinking scale** — kept as the existing boolean Yes/No to avoid a breaking change to the
  matching engine's lifestyle scorer.
- **Match caching / precalculation / background jobs** — matches are computed on demand; at the current profile
  count (dozens, not thousands) this is well under a second and adds no perceptible latency. Existing indexes on
  `Match(profileAId, profileBId, status)` are the only performance work in place. A job queue and cache-invalidation
  layer would be real operational complexity with no current payoff — revisit if the profile count grows by orders
  of magnitude.
- **DB/permission-dependent matching test scenarios** (duplicate profiles, gender filtering, permission security,
  archived/inactive exclusion) are verified live against production rather than as executable Vitest tests — this
  project has no test database. The pure scoring logic (`src/lib/matching.ts`) does have real unit tests (`npm test`).

## Security notes

- Contact info, income, and other sensitive fields are never sent to the browser unless an admin explicitly
  requests them through a permission-checked, audited endpoint.
- Passwords are hashed with bcrypt; sessions are signed JWTs (`NEXTAUTH_SECRET`).
- Every admin API route re-validates the session and the specific permission required for that action
  (`src/lib/route-guard.ts` + `src/lib/permissions.ts`) — this is a deliberate defense-in-depth layer independent of
  `middleware.ts`.
- Registration and self-service update-request endpoints are rate-limited (in-memory token bucket —
  `src/lib/rate-limit.ts`; swap for a Redis-backed limiter before running more than one server instance).
- Uploaded photos are validated by MIME type and size, then re-encoded with `sharp` (which also strips EXIF/GPS
  metadata) before being uploaded to Vercel Blob. Blob URLs are unlisted (long random tokens) but not
  authenticated by the storage layer itself — the actual access control is that the URL is only ever known
  server-side and is never sent to the browser; all reads go through an authenticated admin route.
- Prisma parameterizes all queries; React escapes all rendered output — standard protection against SQL injection
  and XSS. No raw HTML is ever rendered from user input.

## Deploying to Vercel

1. Push this repo to GitHub, then import it in Vercel (or `vercel link`).
2. Under the project's **Storage** tab, add a Postgres database (Vercel's own integration, backed by Neon) — this
   sets `DATABASE_URL` for you automatically. Any other Postgres provider works too; just add `DATABASE_URL`
   manually under **Settings → Environment Variables**.
3. Add `NEXTAUTH_SECRET` under **Settings → Environment Variables** (`openssl rand -base64 32`).
4. Deploy. The build runs `prisma db push` before `next build`, so the schema is created in that database on first
   deploy — no separate migration step needed.
5. Once it's live, run the seed **once** against that same database to get the super admin login and demo data:
   `vercel env pull .env.production.local && npm run db:seed` (uses whichever `.env*` file is present — see
   `SEED_ADMIN_PASSWORD` above to set a real password rather than the default).

6. Under the project's **Storage** tab, add a **Blob** store — this sets `BLOB_READ_WRITE_TOKEN` for you
   automatically, which `src/lib/storage.ts` needs for photo uploads.

Once `DATABASE_URL`, `NEXTAUTH_SECRET`, and `BLOB_READ_WRITE_TOKEN` are all set, everything works: registration,
photo uploads, matching, proposals, and the admin dashboard.

## Photo storage

Photos are written/read through `src/lib/storage.ts` (`savePhoto` / `readPhoto` / `deletePhoto`), backed by
[Vercel Blob](https://vercel.com/docs/storage/vercel-blob). To swap in a different provider (S3, Cloudinary, etc.),
replace the implementations in that one file — nothing else in the app touches storage directly.

## Project structure

```
prisma/schema.prisma       Database schema (see inline comments for Postgres migration notes)
prisma/seed.ts             Demo admin + 20 demo profiles
src/lib/matching.ts        The matching/scoring engine (pure functions, no DB access)
src/lib/permissions.ts     Role → permission matrix
src/lib/route-guard.ts     Server-side auth/permission check used by every admin API route
src/lib/audit.ts           writeAudit() helper used throughout
src/lib/storage.ts         Photo upload/read/delete (local disk — swap for cloud storage here)
src/lib/notifications.ts   NotificationService interface (console-only implementation)
src/app/(public)/          Landing page, registration wizard, update-request, legal pages
src/app/admin/(shell)/     Authenticated admin dashboard, profiles, proposals, follow-ups, audit log, settings
src/app/api/admin/         All admin-only API routes (protected by middleware.ts + requireAdmin())
src/app/api/register/      Public profile submission endpoint
```

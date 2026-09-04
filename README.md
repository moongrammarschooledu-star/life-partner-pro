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
  city/age·education·profession-closest) and filter (minimum score, city, education, profession, verified/active
  only) the ranked results, then open a full comparison panel per candidate showing the mutual **A→B / B→A /
  blended** compatibility, a per-category breakdown (percentage bar **and** a ✓ compatible / ⚠ partial / ✕
  incompatible / — unknown indicator — missing data is never shown as a penalty), an admin recommendation + private
  note ("Save Match Decision"), and proposal creation with a priority level.
- **Global search & notifications:** a topbar search (name / Profile ID / phone / city / profession) and a
  computed notifications panel (profiles awaiting verification, follow-ups due, new high-compatibility matches,
  recent proposal responses) — the notifications are assembled live from existing tables on every request, not a
  persisted/event-sourced notification log.
- **Profile management:** server-side paginated/filterable table (collapses to cards on mobile, filterable by
  gender/status/city/age/education/profession/marital status/verification), full detail view with edit, verify,
  status lifecycle, soft-delete/restore, internal notes, a browsable communication history, and a per-profile audit
  trail.
- **Matching engine** (`src/lib/matching.ts`): compatibility is scored as *mutual* — every preference-based category
  (age, location, education, profession, income, marital status, height, family) checks both directions (does the
  candidate meet the seeker's stated preference, **and** does the seeker meet the candidate's), taking the weaker of
  the two, so a one-sided mismatch pulls the score down. Religious and lifestyle compatibility compare both
  profiles' actual attributes directly. Default weights (age 15% / location 15% / education 10% / profession 10% /
  income 10% / marital status 10% / height 5% / family 10% / religious 10% / lifestyle 5%), match-tier thresholds,
  and a per-category hard-requirement toggle are all admin-configurable from Settings. Each category is classified
  as Compatible / Partially Compatible / Incompatible / **Unknown** — missing data is never silently treated as a
  mismatch. A category marked as a hard requirement excludes a candidate entirely (rather than just lowering their
  score) if that category comes back Incompatible. Results are always framed as compatibility *suggestions*, never
  guaranteed matches — final decisions stay with the admin.
- **Match workflow:** viewing a candidate in the comparison view persists a `Match` record (with per-category score
  columns and the full breakdown) carrying its own status (`Suggested → Reviewed → Approved/Rejected →
  Proposal Created → Closed`) and an optional admin recommendation, independent of any proposal created from it.
- **Proposals:** create a proposal (with a Low/Medium/High priority) between two profiles from the Matching Center
  or a profile's Matches tab (linked back to the `Match` it came from, snapshotting its score), then move it through
  Draft → Sent → Interested/Not Interested → Waiting → Meeting → Finalized → Closed, with a visible timeline. The
  proposal list is tabbed by status and shows match %, priority, and the creating admin.
- **Contact sharing:** approving contact sharing on a proposal requires picking which channels (phone/WhatsApp/email)
  are being shared and confirming that consent was received from both parties — never a single blanket checkbox —
  and every share records exactly which channels were approved.
- **Consent:** registration records four distinct, versioned consent flags (privacy, matchmaking use, contact
  sharing, terms) rather than one blanket checkbox. A profile cannot be moved to `ACTIVE` status until all four are
  on record.
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
  and verified/active-only; the spec's full list (income, marital status, height, family, religion, lifestyle) isn't
  each broken out as its own filter control yet.
- **Standalone cross-profile "Admin Notes" / "Communications" pages** — notes and communication history are
  per-profile (and per-match/per-proposal for notes), which already surfaces the same information without a
  separate aggregated view.
- **Saved filter presets and CSV import** — not implemented; CSV *export* already exists on the Reports page.

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

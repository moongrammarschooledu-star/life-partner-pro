# Final Production Audit Report — STEP 33

Scope: the whole Life Partner Pro repository at the STEP 33 branch (`step33-final-production-audit`, built on `main` 35371fe).
Method: source inspection, a new per-handler static audit of every API route (`npm run audit:routes`), targeted code review of the
authentication, authorisation, privacy, payment and workflow paths, new automated tests, and the full gate (type-check, tests, lint,
security scan, dependency audit, migration check).

**This report states only what was actually run or read.** Where something could not be verified here it says so, and the item is listed
under *Not verified*. Nothing in this report is a security certification or a legal-compliance claim.

## 1. Executive summary

| | |
|---|---|
| Final status of this branch's code | **READY_WITH_WARNINGS** |
| Final status of the live site today (35371fe) | **NOT_READY** until this branch is deployed (a critical authentication weakness is live) |
| Critical issues found | 1 (applicant sign-in), fixed in this branch |
| High issues found | 7, all fixed in this branch |
| Medium and low issues | 5 fixed in this branch (OTP counter, log content, pre-login routes, public health detail, one index) plus 3 flaky-test fixes; the rest are listed as warnings in the matrix |
| Unresolved production blockers after deployment of this branch | none known (see `PRODUCTION_BLOCKERS.md`) |
| Not verified | browser end-to-end suite, load at 100k to 500k profiles, full restore (files and workflows), accessibility tooling, mobile device testing |

Why the live site is NOT_READY today: until this branch is deployed, anyone who knows an applicant's Profile ID and e-mail address
can sign in as that applicant. The fix is in this branch and is switched on by default (`auth.applicant_otp_login.enabled`).

## 2. What was run

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | pass |
| Unit and integration tests (`vitest run`) | **200 files, 2,495 tests, all passed** on the final run of this branch (earlier runs showed timing failures in three slow tests when another heavy process was running; those tests passed on their own and their timeouts were raised) |
| Lint (`eslint`) | 0 errors, 64 warnings (React effect warnings that predate this step) |
| Static security scan (`npm run security:scan`) | pass (static checks only; it is not proof of security) |
| Dependency audit (`npm run deps:audit`) | pass: 0 critical, 3 high that are reviewed exceptions (`prisma`, `@prisma/config`, `deepmerge-ts`: build-time tooling, not in the request path), 2 moderate (`exceljs`, `uuid`) |
| Migration check (`npm run db:migrate:validate`) | pass, 28 migrations (one added in this step) |
| Per-handler route audit (`npm run audit:routes`) | 710 routes, 895 handlers, 0 critical, 0 high, 8 medium (7 routes with no try/catch of their own that answer with the framework's generic error, and 1 public guide page identified by a slug) |
| CI on `main` (GitHub) | green since 35371fe (the schema-drift failure that had been red since STEP 30 was fixed in PR #2) |

Inventory: 710 API routes (895 handlers), 175 pages, 312 database models, 28 migrations, 530 library modules, about 200 test files.

## 3. Audit matrix

Status: PASS, PASS_WITH_WARNING, NEEDS_FIX, CRITICAL, NOT_IMPLEMENTED, NOT_CONFIGURED. "Fixed" means fixed in this branch, not yet in production.

| Area | Status | Severity | Issue | Required fix | Where |
|---|---|---|---|---|---|
| Applicant authentication | CRITICAL → fixed | CRITICAL | Sign-in was Profile ID + e-mail only; the Profile ID is shown to the other party of a proposal, e-mail addresses are not secret | e-mailed one-time code as a second step, flag `auth.applicant_otp_login.enabled` (default ON) | `api/my-status`, `api/my-status/verify`, `lib/applicant-login.ts` |
| Applicant sessions | NEEDS_FIX → fixed | HIGH | The session-id cookie was optional, so revoking a session (or signing out everywhere) could be sidestepped by dropping that cookie | the cookie is now required | `lib/require-applicant.ts` |
| Authorisation: profile sub-resources | NEEDS_FIX → fixed | HIGH | "No Assignment = No Access" was enforced only on the profile detail and status routes; notes, matches and change-request approval were open to any assignment-scoped staff member | `assertProfileAssignmentAccess` on notes (3 handlers), matches (2), pending-update; a test now walks every route under `/api/admin/profiles` | `api/admin/profiles/[id]/...` |
| Privacy: contact search | NEEDS_FIX → fixed | HIGH | Searching the profile list or the global search by phone number matched hidden contact columns for any administrator with `profile:view` (a digit-by-digit oracle) | the contact columns are only searched with `sensitive:contact:view` | `api/admin/profiles`, `api/admin/search` |
| Payments: refunds | NEEDS_FIX → fixed | HIGH | `executeRefund` checked the status by reading it, so two simultaneous executions both reached the provider (double refund); approve and reject had the same shape | atomic compare-and-set on the refund status; the loser gets a 409 | `lib/finance/refund.ts` |
| Payments: manual payment verification | NEEDS_FIX → fixed | HIGH | two simultaneous verifications could both activate the subscription | conditional claim inside one transaction | `lib/finance/manual-payment.ts` |
| Proposal workflow: responses | NEEDS_FIX → fixed | HIGH | an applicant response was accepted in any proposal status and recomputed the status, so it could pull a scheduled or finalised proposal back or re-open one staff had closed | responses only while the proposal is collecting them; never moves a proposal backwards | `lib/proposal-response.ts`, `lib/proposal-workflow.ts` |
| Proposal workflow: contact consent | NEEDS_FIX → fixed | HIGH | contact permission could be granted on a proposal in any status and, once both had, forced the status to CONTACT_APPROVED even on a rejected, archived or finalised proposal | grant/request only after mutual interest and while the proposal is open; revoking is always allowed | `lib/proposal-permissions.ts` |
| OTP attempt counting | NEEDS_FIX → fixed | MEDIUM | the wrong-guess counter was read-then-write, so parallel guesses under-counted | atomic increment | `lib/verification/otp-service.ts` |
| Logging | NEEDS_FIX → fixed | MEDIUM | the console fallback for e-mail and the sandbox channels printed the full recipient and message body | masked recipient; no body in production (the owner's `COMMUNICATION_DEBUG_OTP=true` switch is still honoured) | `lib/communications/providers/shared.ts` |
| Public health endpoint | PASS_WITH_WARNING → fixed | LOW | listed which optional providers were not configured | those entries are omitted from the public view; the admin view keeps them | `lib/ops/health.ts` |
| Pre-login routes | NEEDS_FIX → fixed | MEDIUM | malformed JSON or non-string values threw a 500 (and an error-log entry) on `admin/auth/verify-otp` and `family/login` | 400 with length limits | those two routes |
| Database performance | NEEDS_FIX → fixed | MEDIUM | exact mobile-number lookups (duplicate detection) had no index | additive migration `ContactInfo_mobileNumber_idx` | `20261011150000_step33_contact_mobile_index` |
| CRM and marketing lead de-duplication | PASS_WITH_WARNING | MEDIUM | the look-ups that decide whether a lead is already an applicant search contact columns by phone and e-mail (`crm/lead-service.ts`, `marketing/dedup.ts`); they are reached only through CRM and marketing permissions and are not exposed to applicants, but they were not reviewed field by field | owner review of who holds the CRM permissions | `lib/crm`, `lib/marketing` |
| Authorisation: other routes | PASS | n/a | 0 critical, 0 high in the per-handler audit; the 8 medium entries are explained in section 2 (AI routes enforce the permission inside the AI pipeline and are recognised as such) | none | `scripts/audit-routes.mjs` |
| Webhooks | PASS_WITH_WARNING | LOW | signature, timestamp and replay protection are delegated to shared libraries and covered by the STEP 32 spoofing and replay tests; no live replay test against a real provider was run | run provider test events before enabling a provider | `api/webhooks/*` |
| File uploads | PASS | n/a | magic-byte type check, size caps, pixel caps and encryption at rest on photos, verification documents and case evidence; a malware/document scan exists from STEP 26 | none | `lib/ops/upload-validation.ts` |
| Payments: entitlements | PASS | n/a | a subscription is activated only from the signed payment webhook or from an administrator verifying a manual payment; a browser claim never grants it | none | `lib/finance/*` |
| Matching | PASS | n/a | no facial, appearance or sensitive-trait scoring anywhere in the code (searched); suggestions are labelled as suggestions | none | `lib/matching*.ts` |
| AI | PASS | n/a | feature routes go through the AI pipeline (permission, flags, rollout, consent, safety, audit); no route imports a provider directly (existing test) | none | `lib/ai` |
| Audit log integrity | PASS_WITH_WARNING | LOW | the only code that deletes audit rows is the retention sweep; there is no database-level trigger preventing an update or delete | a trigger or a separate append-only store is a possible later hardening | `lib/privacy/retention-policy.ts` |
| Row-level security (RLS) | NOT_IMPLEMENTED | MEDIUM | the application uses Prisma on Neon with one database role; there are no Postgres RLS policies. Authorisation is enforced in the application layer and tested there | decision for the owner: accept, or add RLS for the most sensitive tables | database |
| Applicant session lifetime | PASS_WITH_WARNING | LOW | applicant cookies and session rows last 365 days | consider 30 to 90 days with renewal | `lib/profile-session.ts` |
| Backups | PASS | n/a | daily encrypted logical backups, verified on creation (decrypt, checksum, schema, integrity comparison) | none | `lib/backup/*` |
| Restore | PASS_WITH_WARNING | MEDIUM | one real restore into an isolated database on 11 Oct 2026: data, migrations, relationships, start-up and an administrator sign-in verified (6 of 8 checklist items). File restore and the critical workflows are not yet verified | repeat once real proposals and payments exist | restore drill `cmv3n1qhf0005kx06fpoofrfg` |
| Disaster recovery | PASS_WITH_WARNING | LOW | plan v2 is approved; RTO is not measured; no tabletop test recorded | run and record a tabletop test | SOC → Disaster recovery |
| Business continuity | PASS_WITH_WARNING | LOW | documented in the DR plan (`businessContinuity` section); no degraded-mode exercise has been run | exercise it | DR plan |
| Preview environments | PASS | n/a | previews no longer touch the production database (label guard) and build against a schema-only Neon branch | none | Vercel and Neon settings |
| Secrets | PASS_WITH_WARNING | MEDIUM | no secret in the repository (scan and manual search); the Neon database password was pasted into a chat during STEP 32 and should be rotated; the owner confirmed nobody else uses the machine, so this is advisable, not urgent | rotate in a quiet window | Neon |
| Environment configuration | PASS | n/a | `.env.example` lists names only; production flags and labels checked; CSP is enforcing | none | Vercel |
| Accessibility and mobile | NOT_CONFIGURED | MEDIUM | no automated accessibility audit and no device test was run | run an audit on the main applicant journey | UI |
| End-to-end (browser) tests | NOT_IMPLEMENTED | MEDIUM | no browser end-to-end suite exists; the lifecycle is covered by state-machine, service and route tests (section 12) | build a suite against a staging environment | tests |
| Load and scale | NOT_CONFIGURED | MEDIUM | not run at 1k, 10k, 100k or 500k profiles; the schema's list and filter columns have indexes (checked) and one was added | run `scripts/load-test.mjs` against a populated staging database | performance |

## 4. Architecture consistency

Server-side authority is consistent: every state change goes through a service or a route that re-reads the database; the browser is not
trusted for status, payment, consent or permission. The STEP 33 findings in this area were all places where a service checked a state by
reading it (refund, manual payment) or did not check it at all (proposal response, contact permission). They are fixed and each has a
test. 110 route handlers have no `try/catch` of their own (the framework answers with a generic 500 without a stack trace); none of
them is a state-changing handler that returns raw error text. This is recorded as a low warning.

## 5. Authentication

* Passwords: bcrypt cost 12; one-time codes: bcrypt cost 10, six-digit sign-in codes, expiry and attempt limit from settings.
* Administrators: e-mail one-time code is now required for privileged roles (SOC configuration v3); sessions are server-side rows,
  12 hours at most, 30 minutes idle; password re-entry for sensitive actions.
* **Applicants (fixed):** the second step is an e-mailed six-digit code. A code is mailed only when the Profile ID and the address both
  match; nothing is signed in and no profile data is returned before the code is proven. Mails to one profile are capped at 5 an hour,
  guesses at 15 per 15 minutes, a code allows 5 attempts and only the newest code works. If e-mail delivery is down the flag can be
  switched off to return to the old sign-in, which must be turned back on as soon as delivery works.
* Family members: password sign-in with enumeration-safe errors and rate limits (unchanged).
* Tested: wrong code, wrong address, unknown Profile ID looking identical to a wrong address, restricted accounts, the per-profile caps,
  malformed bodies, flag off, atomic attempt counting, retired codes, expired codes.

## 6. Authorisation and RBAC

The per-handler audit covers all 895 handlers. Findings fixed: the profile sub-resource assignment gaps and the contact search oracle.
By design and documented: photos are fetched by assignment-scoped staff for every profile shown in the list (the list thumbnails use the
photo route), and verification work is queue-based rather than assignment-based. Both are recorded as explicit exceptions in
`profile-route-assignment.test.ts`, and a test fails if a new profile route is added without either the assignment check or a reason.

## 7. Sensitive data, API security, database

* Sensitive fields: list and detail views already filter fields by permission (serialisers); this step closed the search oracle.
* API: no unsafe raw SQL in any route (checked by the standing audit); inputs on public routes are length-limited; error text returned
  to callers is limited to known errors (checked by the standing audit).
* Database: foreign keys and constraints are defined by 28 migrations that reproduce `schema.prisma` exactly (the CI migration diff is
  green); the one scratch restore validated 343 foreign keys with no orphans on the five relations checked.
* RLS: not used (see matrix).

## 8. Matching, proposals, contact workflow, family portal

State machines: `nextProposalStatus`, `statusAfterResponse`, the contact permission service and the meeting workflow. Fixed in this
step: a response or a contact consent can no longer rewind, re-open or force a status. Tests: new cases in `proposal-response.test.ts` and
`proposal-permissions.test.ts` cover every closed or advanced status, withdrawal, and no-rewind. Family members can act only through shared records and permissions
(unchanged, existing tests). Contact is never disclosed automatically: sharing still requires both profiles' consent, the maker-checker
gate and an audit entry.

## 9. Verification, risk, communication, webhooks, payments, documents, AI, CRM, marketing, analytics

Reviewed through the standing structure tests from STEPs 16 to 31 plus the targeted checks above. No new defect beyond those listed.
Not re-audited line by line: marketing and analytics payload minimisation (covered by the STEP 29 and 31 tests).

## 10. Security operations, backup, restore, disaster recovery, business continuity

Live readiness (SOC) shows 9 of 13 checks passing and 4 warnings: restore not fully proven, backup files are addressable by URL (they
are ciphertext), RTO not measured, no tabletop test. CSP is enforcing; MFA coverage is 3 of 3 privileged administrators.

## 11. Performance

Indexes were checked for the main list and filter columns (profile status, city, gender, verified, created; proposal status and
assignee; audit log; notifications; security events; payments). One missing index was added (mobile number). No load test was run.

## 12. Lifecycle coverage (no browser E2E suite exists)

| Stage | Covered by |
|---|---|
| Visitor, lead, registration | registration, CRM and marketing service tests |
| Verification and review | verification and workflow tests |
| Matching and proposal creation | matching and proposal tests |
| Response, mutual interest, rejection, withdrawal, expiry | `proposal-response.test.ts` (new cases), `proposal-workflow.test.ts` |
| Contact permission and approval | `proposal-permissions.test.ts` (new cases), maker-checker tests |
| Family coordination | family access and decision tests |
| Meeting, follow-up, finalisation | `meeting-workflow.test.ts`, proposal status tests |
| Suspension, deletion, family revocation | restriction, privacy and family tests |

A browser end-to-end suite that drives these through the real application and a database is **not implemented**.

## 13. Issues by severity

* Critical: 1 (fixed in code). High: 7 (fixed in code). Medium and low: see the matrix; the open ones are warnings (RLS not used, restore only
  partly proven, accessibility, browser E2E and load not run, CRM de-duplication review, audit-log trigger, applicant session length, a narrow
  lost-update window in proposal responses, a coupon usage-limit race that can over-redeem by one or two, 110 handlers without their own try/catch).

## 14. Remaining manual configuration

1. Deploy this branch (the applicant sign-in fix is not live until then).
2. After deployment, sign in once as an applicant to confirm the code arrives, and keep the Vercel flag name in mind in case e-mail fails.
3. Rotate the Neon database password in a quiet window.
4. Delete `.env.backup-key` once the backup key is in a password manager.
5. Repeat the restore drill when real proposals and payments exist.

## 15. Rollback plan

* Applicant sign-in: turn off `auth.applicant_otp_login.enabled` (System Config → Feature flags, administrator password required).
* Code: Vercel → Deployments → promote the previous production deployment (35371fe).
* Database: the only schema change is one additive index; to undo it run `DROP INDEX "ContactInfo_mobileNumber_idx"` (not needed for correctness).

## 16. Final readiness status

* This branch's code: **READY_WITH_WARNINGS**.
* The live production site today: **NOT_READY** until this branch is deployed.
* **PRODUCTION_READY is not claimed**, because the restore is only partly proven, no browser end-to-end or load test has been run, and the
  items under "Not verified" remain open.

## 17. Final gate (run on the finished branch)

| Gate | Result |
|---|---|
| `tsc --noEmit` | pass |
| `vitest run` | 200 files, 2,495 tests, all pass |
| `eslint` on the files changed in this step | 0 errors (1 warning that predates this step) |
| `security:scan` | pass (static checks) |
| `db:migrate:validate` | pass, 28 migrations |
| `audit:routes` | 0 critical, 0 high |
| `next build` | **not run locally** (a full local build is slow on this machine and the Vercel build is the build check); it runs on deployment |

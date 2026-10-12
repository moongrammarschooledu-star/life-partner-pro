# Final deployment report (STEP 34)

Written 2026-10-12 on branch `step34-deployment-go-live` (not yet merged or deployed). "Verified" means it was actually run or observed; anything else says so. Nothing was enabled in production by this work: payments, WhatsApp, SMS, marketing and AI stay off.

## 1. Environment
Three environments, kept apart by labels (`APP_ENV`, `DATABASE_ENV_LABEL`, `STORAGE_ENV_LABEL`, `PAYMENT_ENVIRONMENT`): Development (laptop, own database), Preview (staging; schema-only Neon branch, no personal data), Production. The full variable inventory is `docs/ENVIRONMENT_VARIABLES.md`; a test now fails if the code reads a variable that is not listed. **Gap:** `.env.backup-key` still exists on the owner's laptop; the Neon password was shared in chat once and should be rotated.

## 2. Hosting
Vercel Hobby, project `lifepartnerpro`, functions in `iad1`, served from the nearest edge (observed `sin1`). Auto-deploy on merge to `main`; Preview per pull request. Hobby limits: one daily cron, short function time. Verified live 2026-10-12.

## 3. Domain
**No custom domain.** The site is `lifepartnerpro.vercel.app`. Everything that needs a domain (APP_URL, e-mail identity, DNS runbook) is ready and documented but waits for the owner to buy/attach one. Not verified (nothing to verify).

## 4. SSL
Verified live: valid Google Trust Services certificate (2026-08-29 to 2026-11-27, renewed by Vercel), `http://` answers 308 to `https://`, HSTS `max-age=31536000; includeSubDomains` (no preload), CSP enforcing, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, COOP. The 15-minute HSTS/certificate/page probe is `.github/workflows/uptime.yml`, active since 2026-10-12 (added through the GitHub web editor because the stored token cannot push workflow files; its first run passed).

## 5. Database
Neon Postgres. 31 migrations validated statically (additive only; STEP 34 adds one column, four audit enum values and two tables). `/api/health/ready` on production answered `ready` (database ok, config ok, state NORMAL). STEP 34's migrations are **not yet applied to production** - they run during the build when the owner merges. Prisma transactions now bounded (5 s wait, 15 s limit). Free plan: about 6 hours of point-in-time history.

## 6. Storage
Vercel Blob; files are AES-256-GCM ciphertext and only served through authorised routes. Limitation: the store itself is public-access (Vercel); addresses are unguessable and never returned by any API. Moving to a private store is a known follow-up. Runbook: `docs/runbooks/storage-failure.md`.

## 7. Queues
No Redis, queue service or worker is used or needed. Background work is the database-backed job table (retry with backoff, dead-letter review), drained by the daily cron and "Run now". Rate limits are persisted in the database. Documented in `docs/DEPLOYMENT.md` s.9.

## 8. CI/CD
`ci.yml` (types, lint, tests, security scan, dependency audit, migration validation, build), `deploy-gate.yml` (live probes + evidence), `backup.yml` (optional), uptime probe `uptime.yml` (active, see section 4). Branch protection and a reviewer-gated `production` Environment are GitHub settings the owner must switch on. Controlled path for risky migrations: `scripts/deploy-db.sh pre|post` (refusals tested; the full run against a real database was not executed).

## 9. Security
Verified now: 2585 tests (208 files); route-authorization audit 0 critical / 0 high; static security scan PASS; dependency audit PASS; live security smoke PASS 12 / FAIL 0 / NOT_RUN 9. Finding fixed in the test tool: the security smoke reported 2 failures on production because its allow-list did not know the intentionally public sign-in-code endpoints (`forgot-password`, `reset-password`, `my-status/verify`) and treated a switched-off AI feature (503) as a leak, plus one network time-out; the endpoints were checked by hand (they are public by design and rate-limited). Not covered by tools: authenticated IDOR, privilege escalation with real sessions, replay with valid signatures - covered by unit tests and need manual review.

## 10. Monitoring
In-app errors, metrics, slow queries, alerts, SOC detection, health pages; uptime probe `.github/workflows/uptime.yml`, active (first run passed); optional `ALERT_WEBHOOK_URL`. **Not configured:** an external uptime service and an error tracker (owner accounts needed).

## 11. Backups
Daily encrypted backup with automatic restore verification inside the daily cron; optional `pg_dump` workflow (off). Authenticated backup status was **not** read from production in this session (the owner types passwords); check Admin > System Health > Backup & Recovery.

## 12. Restore test
Mechanism exists (restore drills with performer + independent reviewer; `scripts/restore-backup.ts` into a scratch database). A drill with real data (file restore, critical workflows) is still open per earlier steps; no restore was run in this step. Measured RTO therefore reads "Not measured yet".

## 13. Disaster recovery
Versioned plan inside the app (needs content and an approval by a second administrator), configured vs measured RPO/RTO, 12 file runbooks in `docs/runbooks/`. Worst case today: a lost database is recoverable to the newest verified backup (daily).

## 14. Business continuity
Contained in the in-app plan section "business continuity"; runbooks give staff-assisted fallbacks (phone contact, e-mail/in-app instead of WhatsApp, maintenance mode). The owner is the single escalation point; a second Super Admin is required.

## 15. Integrations
Vercel, Neon, Blob, GitHub: working. SMTP (Gmail): sends but without a verified domain. Payments, WhatsApp, SMS, Meta ads, identity verification vendor: **not configured / off**. Circuit breaker and per-channel switches added so a failing provider cannot cascade.

## 16. Payment status
**OFF.** Master switch off; kill switch available; no production credentials; rollout to be done by the owner (sandbox first). Nothing in this step changes it.

## 17. Communication status
E-mail: SMTP, channel flag `email.enabled` on (default); applicant sign-in code by e-mail is live (owner still to confirm arrival). SMS and WhatsApp: not configured; `sms.enabled` default on but no provider, `whatsapp.enabled` and marketing/engagement flags default off. Each channel can be held without deleting messages.

## 18. AI status
Disabled by default (`ai.enabled` and all `ai.*` flags off; rollout phase DISABLED). Unchanged.

## 19. Feature flags
Visible at Admin > Deployment & Go-Live > Switches & flags. New: `sms.enabled`, `email.enabled`, emergency switch `contactSharing`. Defaults: ai./communications./marketing./engagement./analytics./soc. prefixes off.

## 20. Current version
`1.0.0-rc.1` (was 0.1.0). Production currently runs STEP 33 (`8faa650`, version 0.1.0). `1.0.0` is cut only after the go-live gate reaches LIVE.

## 21. Deployment timestamp
STEP 34 is **not deployed**. Last production deployment: STEP 33, `8faa650`. The timestamp will appear in Admin > Deployment & Go-Live once the owner merges.

## 22. Smoke test results
Live production, unauthenticated, 2026-10-12 (STEP 33 build): smoke PASS 18 / FAIL 0 / NOT_RUN 17 (the 17 need a login); security smoke PASS 12 / FAIL 0 / NOT_RUN 9 after the tool fix. Not run against the STEP 34 build (not deployed). Authenticated flows must be checked by a person.

## 23. Known issues
1. No custom domain, no verified e-mail domain (deliverability and Gmail daily limit risk).
2. Daily cron only (Hobby): detection, reminders and backups run once a day.
3. Neon free history is about 6 hours.
4. Blob store is public-access (ciphertext only).
5. Restore drill with real data not yet done; DR plan content not yet approved.
6. Go-live approval needs two different Super Admins; check a second exists.
7. Deploy-gate evidence from before the tool fix may show a failed security smoke; it clears on the next deploy.
8. The production build has not been verified yet (the laptop is too small to run it); CI and the Vercel build on the pull request are the check.
9. Owner tasks: rotate the Neon password, remove `.env.backup-key`, set GitHub branch protection and the `EVIDENCE_URL` secret.

## 24. Rollback plan
Application: promote the previous deployment in Vercel (seconds, no rebuild), then record it in Production Readiness > Releases. Database: migrations are forward-only and additive, so the older code runs on the newer schema; data damage uses Neon point-in-time restore or an encrypted backup into a scratch database (`docs/runbooks/rollback.md`, `database-recovery.md`). The new migrations add objects only; none is destructive.

## 25. Go-live status
**GO_LIVE_BLOCKED.** The gate starts blocked by design, STEP 34 is not deployed, and several required readiness items depend on owner actions listed in `GO_LIVE_CHECKLIST.md`. The system is **not** marked LIVE and cannot be marked LIVE without readiness passing and a second administrator approving.

## 26. Verification record for this change
| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | passed |
| Tests, full run | 2585 tests / 208 files; 2584 passed; 1 failing documentation test (could not read the new `docs/runbooks` folder) fixed and re-run: that file 53/53 |
| Lint on changed areas | 0 errors (1 existing warning in `shared.tsx`) |
| Security scan / dependency audit / migration validation / route audit | pass / pass / 31 validated / 0 critical, 0 high |
| Prisma schema vs migration SQL | identical (`prisma migrate diff`) |
| Production build (`next build --webpack`, local) | **not completed**: Node ran out of memory after about 12 minutes (default 2 GB heap; this laptop has 3.9 GB RAM, 1.2 GB free). Not a code error, but also not proof the build passes. The build proof will be the CI `build` job on the pull request and the Vercel build; a failed migration or build there leaves the current version serving |
| Migrations applied to a real database in this session | **no** (they run on deploy; the CI job applies all migrations to an empty Postgres) |
| Go-live gate tested end to end | in-memory database tests (36 tests); not against production |

Build update: local build ran out of memory (exit 134); waiting on CI/Vercel for the real build result.

# Deployment audit (STEP 34 - inspection before changes)

Date of inspection: 2026-10-12. Scope: what exists today for production deployment, what was missing, what STEP 34 added. Nothing here is claimed unless it was read in the code or observed on the live site; items that need an account or an action only the owner can take are listed as such.

## 1. What was found (before STEP 34)

| Area | Finding | Evidence |
|---|---|---|
| Hosting | Vercel, **Hobby plan**, production project `lifepartnerpro`, auto-deploy of `main`, functions in `iad1`, edge served from the nearest point (observed `sin1`) | Vercel project; response header `x-vercel-id` |
| Database | Neon Postgres (free plan: about 6 hours of point-in-time history, branches available). Pooled `DATABASE_URL`; migrations use the direct host | `scripts/migrate-deploy.mjs` |
| Storage | Vercel Blob, AES-256-GCM ciphertext, addresses never exposed; store is **public-access** (Vercel limitation) | `docs/DEPLOYMENT.md` s.8 |
| CI | `ci.yml` (types, lint, tests, security scan, dependency audit, migration validation, build), `deploy-gate.yml` (probes the live URL after each production deploy), `backup.yml` (optional `pg_dump`) | `.github/workflows/` |
| Migrations | Versioned, additive, destructive SQL refused without a written approval; failed migration fails the build so the previous version keeps serving | `scripts/migrate-deploy.mjs`, `scripts/check-migrations.mjs` |
| Releases | `Release` records (`LPP-REL-######`) registered on first start of a build, self-verified; rollback assessment | `src/lib/ops/releases.ts` |
| Readiness | Computed gates (STEP 15) - cannot be set by hand | `src/lib/ops/gates.ts` |
| Backups | Daily encrypted logical backup with automatic restore verification; restore only via `scripts/restore-backup.ts`; restore drills with independent reviewer (STEP 32) | `src/lib/backup`, SOC pages |
| Monitoring | In-app errors, metrics, alerts, slow queries, SOC detection; optional alert webhook | System Health, Alerts |
| Emergency switches | payments, registrations, profile submissions, matching, proposals, notifications, uploads, public access (STEP 15/19) | `src/lib/ops/system-control.ts` |
| Security headers | HSTS (1 year, includeSubDomains), CSP enforcing, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP | live `curl -I` on 2026-10-12 |
| TLS | Valid certificate issued by Google Trust Services, valid until 2026-11-27 (auto-renewed by Vercel); `http://` answers 308 to `https://` | live check |
| Health endpoints | `/api/health/live`, `/api/health/ready` (database, config, state) answered `ready`; `/api/health` detailed for admins | live check |
| Cron | One daily cron (08:00 UTC) - Hobby allows no more; drives notifications, backups, SOC detection, jobs | `vercel.json` |
| Domain | **No custom domain.** Site is `lifepartnerpro.vercel.app` | Vercel |
| E-mail | SMTP via a Gmail mailbox (no verified sending domain, so no SPF/DKIM/DMARC under our control) | `.env.example`, STEP 25 notes |
| Payments / WhatsApp / SMS | Not configured with production credentials; payments master switch OFF | Finance Center rollout |
| Error tracker / external uptime | None external (in-app only) | - |
| Redis / queues / workers | Not used. Background work is the DB-backed job table run by the daily tick or "Run now" | `BackgroundJob` |

## 2. Gaps found and what STEP 34 did about each

| Gap | Resolution in STEP 34 |
|---|---|
| No go-live decision record; production state was only "deployed" | **Go-live approval gate**: `GO_LIVE_BLOCKED -> GO_LIVE_READY -> GO_LIVE_APPROVED -> LIVE`, two different administrators, gates re-checked at every step, build-bound, history and audit (`/admin/deployment`, `/api/admin/go-live`) |
| No single deployment summary | `/admin/deployment`: version, commit, deploy date, previous release, latest migration, health, latest backup, last restore test/drill, switches and flags |
| Demo seed could in principle be run against any database in the environment | `assertSeedAllowed()` refuses unless the database is labelled development or local AND `ALLOW_DEMO_SEED=true`; never in production |
| E-mailed links could be built from an empty setting (relative or localhost link) | `publicUrl()` - one canonical https origin; production refuses to build a link without it; tests forbid the old pattern |
| No per-channel kill switch for SMS and e-mail; no contact-sharing kill switch | `sms.enabled`, `email.enabled` flags (messages held, never deleted; sign-in/reset codes unaffected); `contactSharing` emergency switch |
| Failing provider kept being retried, wasting attempts | **Circuit breaker**: DOWN provider skipped for 5 minutes, message re-queued for the reopen time, no attempt consumed |
| Prisma transactions used library defaults (2 s wait / 5 s run) | Bounded explicitly: 5 s wait for a connection, 15 s transaction limit |
| No outside-in uptime check | `.github/workflows/uptime.yml` (active since 2026-10-12): every 15 minutes probes pages, health, HSTS and certificate life; opens one `outage` issue on failure |
| No controlled DB deployment script | `scripts/deploy-db.sh pre|post` (backup proof required, validate, migrate, integrity, wait, smoke) |
| Version was `0.1.0` | `1.0.0-rc.1` until the owner declares launch; `CHANGELOG.md` started |
| Runbooks existed in-app only | 12 file runbooks in `docs/runbooks/` with symptoms, diagnosis, actions, verification, escalation, recovery, rollback, post-incident |
| Environment variables partly undocumented (about 45 names missing from `.env.example`) | Names added (values empty); `docs/ENVIRONMENT_VARIABLES.md` inventory |

## 3. Items that cannot be fixed in code (owner action needed)

1. **Custom domain** + DNS + `APP_URL` pointing at it (then HSTS preload is a decision, not automatic).
2. **Verified e-mail sending domain** with SPF, DKIM and DMARC; today's Gmail sender is a deliverability and daily-limit risk at launch volume.
3. **External uptime monitor and error tracker accounts** (the GitHub probe is a start, not a replacement).
4. **GitHub branch protection** on `main` and a `production` Environment with required reviewers (a GitHub setting, not a file).
5. **Second Super Admin** - the go-live gate needs two different people; with one administrator it can reach READY but never APPROVED (by design).
6. **Production payment, WhatsApp and SMS credentials** - only after the controlled rollout; none are enabled automatically.
7. **Neon plan**: 6-hour history is short; paid plan or the `pg_dump` workflow for longer recovery. Rotate the database password (it was shared in a chat earlier).
8. **Private file storage** when available; restore drill with real data; remove `.env.backup-key` after storing the key safely.

## 4. Method and limits

Read: workflows, `vercel.json`, `next.config.ts`, migration runner, ops libraries, schema. Observed: live response headers, TLS certificate, redirect, health JSON. **Not done:** authenticated browsing of production (the owner types passwords), load testing against production, DNS tests (no domain), real e-mail delivery to external mailboxes, real payment/WhatsApp/SMS sends.

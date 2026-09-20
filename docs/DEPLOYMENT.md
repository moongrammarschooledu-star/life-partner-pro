# Deployment, environments, migrations & recovery

This document is the operational counterpart of STEP 15. It says exactly what the
code does and what must be configured by hand in Vercel / Neon / GitHub — nothing
here is claimed to be configured until you have done it and the **Production
Readiness** page (Admin → Production Readiness) shows it verified.

## 1. Environments

| | Development | Staging | Production |
|---|---|---|---|
| Purpose | local work, demo data | production-like verification | real users |
| `APP_ENV` | `development` | `staging` (Vercel *Preview*) | `production` |
| Database | own DB / Neon branch | **own** DB / Neon branch | own DB |
| Storage | own Blob store | own Blob store | own Blob store |
| Payments | none / sandbox | sandbox only | production provider only |
| Secrets | throw-away | separate from production | production only |

**Never mix** databases, storage, payment credentials or secrets between them.
The code enforces this by *labels*: set `DATABASE_ENV_LABEL`, `STORAGE_ENV_LABEL`
and `PAYMENT_ENVIRONMENT` in each Vercel environment. If a label disagrees with
`APP_ENV` the app reports a CRITICAL configuration error, `/api/health/ready`
fails, and `npm run vercel-build` refuses to migrate.

> **Known gap at the time of writing:** local development and production use the
> same Neon database. Create a separate Neon branch/database for development and
> for staging and put its URL in the matching Vercel environment.

Variables are documented in `.env.example`. Public (browser-visible) variables
must start with `NEXT_PUBLIC_` and must never hold secrets — the security scan
fails the pipeline otherwise. Server configuration is only reachable through
`getServerConfig()` (`src/lib/config/server-config.ts`, `server-only`).

## 2. Branches and release flow

```
feature/*  →  development  →  staging  →  main (production)
```

* `main` is production. **Protect it** (GitHub → Settings → Branches): require a
  pull request, require the `CI / verify` check, require review, block force
  pushes. *(manual GitHub setting)*
* `staging` deploys to a Vercel Preview with staging environment variables.
* Production deployment authorisation: create a GitHub Environment `production`
  with **required reviewers** (used by `deploy-gate.yml`) and, in Vercel, use
  "Ignored Build Step" or disable auto-deploy for `main` if you want deployment
  itself to wait for approval. *(manual)*
* Each production build is recorded automatically as a release (`LPP-REL-######`)
  the first time an instance starts, verified (database + configuration), and
  can then be **approved** by a SUPER_ADMIN in Production Readiness → Releases.

## 3. Pipeline

`.github/workflows/ci.yml` — install → type check → lint → unit tests (incl. the
route-authorization coverage guard) → static security scan → dependency audit →
migration validation (applies migrations to an empty Postgres and diffs against
`schema.prisma`) → build. Each stage posts evidence to the app when
`CI_EVIDENCE_TOKEN` and `EVIDENCE_URL` secrets are set.

`.github/workflows/deploy-gate.yml` — after Vercel reports a deployment ready,
probes the **live URL** (health, smoke, security smoke) and posts evidence. A
deployment is only "successful" when build **and** deploy **and** health **and**
smoke have passed.

`.github/workflows/backup.yml` — optional `pg_dump` (off unless the repository
variable `BACKUP_WORKFLOW_ENABLED` is `true`).

Local equivalents: `npm run typecheck`, `npm run lint`, `npm test`,
`npm run security:scan`, `npm run deps:audit`, `npm run db:migrate:validate`,
`npm run smoke -- --url <site>`, `npm run smoke:security -- --url <site>`,
`npm run load-test -- --url <staging> --allow-remote`.

## 4. Database migrations

The project used `prisma db push --accept-data-loss` on every deploy (no history,
no rollback). It now uses versioned migrations:

| Task | Command |
|---|---|
| New migration in development | `npm run db:migrate:dev -- --name describe_change` |
| Validate migrations (static) | `npm run db:migrate:validate` |
| Apply to staging / production | happens in `npm run vercel-build` (or `npm run db:migrate:deploy`) |
| Status | `npm run db:migrate:status` |

Rules: commit the generated `prisma/migrations/*`; make releases
backward-compatible (expand → migrate → contract); a migration containing
destructive SQL (`DROP`, `TRUNCATE`, `DELETE FROM`, column type change) is
**rejected** unless the folder also contains `DESTRUCTIVE_APPROVED.md` recording
the backup taken and the approver. Take and verify a backup before any
high-risk migration. A failed migration fails the build, so the previous
deployment keeps serving.

**One-time baseline for an existing database** (created earlier with `db push`):

```bash
npx prisma migrate resolve --applied 0_init   # writes only the _prisma_migrations table
```

Do this **before** the first deployment that uses `vercel-build`, otherwise the
build tries to re-create existing tables and fails (safely).

## 5. Rollback

Prisma migrations are forward-only. Production Readiness → Releases shows, for a
release, whether rolling back to the previous stable one is `SAFE` (no newer
migrations), `REQUIRES_REVIEW` (newer migrations exist — confirm the older code
tolerates the newer schema, or restore from a verified backup) or `UNKNOWN`.
The deployment itself is reverted in Vercel ("Promote" the previous deployment);
record it in the app afterwards (password re-confirmation + reason).

## 6. Backup and recovery

* **Primary DB recovery:** Neon point-in-time recovery *(enable and test it in
  the Neon console — manual)*.
* **In-app backups:** daily, in the once-a-day Vercel cron tick: an encrypted
  logical export of every table (AES-256-GCM, key `BACKUP_ENCRYPTION_KEY`),
  followed by an automatic **restore verification** (download → checksum →
  decrypt → parse → manifest → schema/FK checks). Private files (photos,
  documents, evidence) are mirrored *as ciphertext* to the backup store.
  Retention (daily/weekly/monthly counts) is configurable in System
  Configuration → Backup Policy.
* **Size limit:** a single serverless invocation cannot back up a very large
  database. Such a run *fails loudly*; use Neon PITR and the optional `pg_dump`
  workflow for that size.
* **Restore:** the application never overwrites data. Request a restore
  (verified backup + typed phrase + password + reason), a *different* SUPER_ADMIN
  approves, then an operator runs
  `BACKUP_ENCRYPTION_KEY=… npx tsx scripts/restore-backup.ts --file <backup> --target-url <empty db>`
  and finally runs **Post-restore validation** in the app. Restoring into the
  live database additionally needs `--truncate --i-understand "OVERWRITE-LIVE-DATABASE"`.
* RPO/RTO are configurable *targets*, not guarantees.

## 7. Required manual configuration (checklist)

- [ ] Separate Neon database/branch for development and staging; production DB
      least-privilege role and IP/network restrictions.
- [ ] Vercel env vars per environment: `APP_ENV` (optional), `APP_URL`,
      `DATABASE_ENV_LABEL`, `STORAGE_ENV_LABEL`, `PAYMENT_ENVIRONMENT`.
- [ ] `CRON_SECRET` and `NOTIFICATION_WEBHOOK_SECRET` (until set, those endpoints
      accept unauthenticated calls — flagged BLOCKER in Production Readiness).
- [ ] `BACKUP_ENCRYPTION_KEY` (+ optional `BACKUP_BLOB_READ_WRITE_TOKEN`).
- [ ] `CI_EVIDENCE_TOKEN` in Vercel **and** as a GitHub secret; `EVIDENCE_URL` secret.
- [ ] Baseline the production migration history (section 4).
- [ ] GitHub branch protection + `production` Environment with reviewers.
- [ ] Custom domain, DNS, HTTPS certificate; set `APP_URL` to it.
- [ ] Email provider (until then messages *and admin OTP codes* only reach the
      server log — treat log access as sensitive).
- [ ] Real payment provider credentials (sandbox first) if card payments are wanted.
- [ ] Enable Neon PITR; run a restore test; set `CSP_MODE=enforce` after reviewing violations.

## 8. Known limits (stated, not hidden)

* Vercel Hobby: one daily cron, short function time → background jobs are
  deferred/retried work run by the daily tick or "Run now", not a real-time queue.
* File/session/step-up keys derive from `NEXTAUTH_SECRET`; rotating it invalidates
  every session and stored file. Key versioning is a follow-up.
* Vercel Blob objects are encrypted but publicly fetchable by URL if guessed
  (URLs are never exposed by any API).
* No external error tracker or distributed tracing backend; monitoring is
  in-app (DB-backed errors, metrics, alerts) plus optional `ALERT_WEBHOOK_URL`.
* CPU/memory metrics are not available on serverless.
* Automated tooling covers unauthenticated behaviour only; authenticated flows,
  IDOR with real users and real payment sandboxes need manual verification.

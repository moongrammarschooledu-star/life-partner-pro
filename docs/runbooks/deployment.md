# Runbook: deployment

How a change reaches production. Vercel deploys `main` automatically; everything before that is a pull request.

## Symptoms (when to use this)
- A new version needs to go live, or a deployment is stuck or marked failed.

## Before you start
1. The pull request is green: **CI / verify** passed (types, lint, tests, security scan, dependency audit, migration validation, build).
2. If the change has a database migration: it is **additive** (new table or column) - a destructive migration is refused by the pipeline unless a written approval file is in its folder.
3. You know the **rollback target**: Admin > Deployment & Go-Live > Release shows the previous healthy release.
4. For a risky migration: take a backup first (see [backup-restore.md](backup-restore.md)) and note its code.

## Steps
1. Merge the pull request into `main` (GitHub). Vercel starts the build.
2. The build runs `node scripts/migrate-deploy.mjs` first: it refuses to run if the database label disagrees with the environment, applies only committed migrations, and **fails the build if a migration fails** - the previous version keeps serving.
3. When Vercel shows **Ready**, the **Deploy gate** workflow probes the live address (health, smoke, security smoke) and posts evidence.
4. The first instance that starts registers the release (`LPP-REL-######`) and verifies database + configuration.

Optional, one phase at a time (risky migrations): `bash scripts/deploy-db.sh pre --backup-ref "<backup code>"`, merge, then `bash scripts/deploy-db.sh post --url https://<site>`.

## Verification
- Vercel deployment: **Ready**; GitHub: CI and Deploy gate green.
- Admin > Deployment & Go-Live > Release: new commit, release **HEALTHY**, expected latest migration.
- Admin > Production Readiness: no new BLOCKED gate.
- Smoke test from your own machine: `node scripts/smoke.mjs --url https://<site>`.
- Log in as an administrator and open the dashboard.

## Diagnosis if it fails
- **Build failed at migrations**: read the Vercel build log for the migration name; nothing was deployed. Fix forward in a new pull request (never edit an applied migration).
- **Build passed but release UNHEALTHY**: open Admin > Production Readiness for the failing check (database or configuration). A missing required environment variable is the usual cause.
- **Deploy gate red**: open the failed step in GitHub Actions; the live address answered something other than expected.

## Escalation
Owner. If the site is serving errors to real people, go to [rollback.md](rollback.md) first and diagnose afterwards.

## Recovery
Fix forward in a new pull request; the previous deployment keeps serving until a build succeeds.

## Rollback
See [rollback.md](rollback.md). Migrations are forward-only; the application code is rolled back in Vercel.

## Post-incident
Record what failed in the pull request, add a test that would have caught it, update `CHANGELOG.md`.

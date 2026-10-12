# Runbook: rollback

Go back to the previous working version of the application. This changes **code**, not data.

## Symptoms
- Errors or broken pages right after a deployment, a failed Deploy gate, a release marked UNHEALTHY, or the monitoring alerting after a release.

## Diagnosis (two minutes)
1. Admin > Deployment & Go-Live > Release: which release is current, which is the previous healthy one, when each was deployed.
2. Admin > Production Readiness > Releases: the rollback assessment for the previous release:
   - **SAFE** - no newer migrations; the old code runs on the current database.
   - **REQUIRES_REVIEW** - newer migrations exist. Because this project only adds tables and columns, old code normally ignores them, but confirm that the old release does not depend on something the migration removed (it never removes anything without an approved file).
3. Is the problem really the release? Check Vercel runtime logs and Admin > System Health. A database or provider problem is not fixed by a rollback - use [database-failure.md](database-failure.md) or [provider-outage.md](provider-outage.md).

## Immediate actions
1. **Vercel dashboard > the project > Deployments** > open the previous healthy deployment > **Promote to Production** (or "Instant Rollback"). It takes effect in seconds; no rebuild and no migration run.
2. If people are being harmed right now (wrong data shown, unsafe sharing) and you cannot roll back yet: switch the affected area off first (Admin > System Configuration > Emergency), then roll back.

## Verification
- `node scripts/smoke.mjs --url https://<site>` passes.
- `/api/health/ready` returns OK.
- Open the dashboard as an administrator; open one applicant page.
- Admin > Deployment & Go-Live shows the older commit as running.

## Record it
Admin > Production Readiness > Releases > the bad release > **Record rollback** (password + reason). This keeps the audit trail and database-compatibility check.

## Escalation
Owner. If the rolled-back version also fails, the cause is outside the code: database, provider or domain.

## Recovery (fixing forward)
Fix the defect in a new pull request with a test. Do not re-promote the bad deployment.

## Rollback (undoing the rollback)
If the older version turns out worse, promote the newer deployment again from the same Deployments list - both stay available. Decide with the owner before flipping back and forth.

## Database rollback
There is none by design: migrations are forward-only and additive. If data was damaged, see [database-recovery.md](database-recovery.md).

## Go-live status
If the system was recorded as LIVE, leave it; the go-live record is about the launch decision. If a *not yet launched* approval exists and you rolled back, it drops to BLOCKED automatically because the running build changed.

## Post-incident
What shipped, how it passed CI, what test is missing. Add the test before the next release.

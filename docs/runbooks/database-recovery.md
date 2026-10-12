# Runbook: database recovery (damaged or wrongly changed data)

The database answers, but the **data is wrong**: rows deleted, a bad migration or script, a wrong bulk change. (If the database does not answer at all, use [database-failure.md](database-failure.md).)

## Symptoms
- Missing applicants, proposals or payments; counts that suddenly dropped; a script or migration was just run; users report their profile is gone.

## Diagnosis
1. **Stop further damage**: switch off the writing area (Admin > System Configuration > Emergency: registrations, proposals, notifications ...) or set the operational state to `EMERGENCY`.
2. Find **when** it happened: Admin > Audit Log (filter by time), Vercel deployment times, GitHub Actions runs.
3. Scope it: which tables, how many rows, is it still happening?
4. Decide the recovery point: the last moment the data was still right.

## Recovery options (cheapest first)
1. **Re-create from the audit trail / re-enter** when a few records are involved.
2. **Neon point-in-time restore into a NEW branch** (Neon console > Branches > Create branch from a past time). The free plan only reaches back about 6 hours - act quickly. Inspect the branch, then copy back only the affected rows (never switch production to the branch blindly; its connection string differs and every environment variable would need to change).
3. **In-app encrypted backup** restored into a scratch database with `scripts/restore-backup.ts` (see [backup-restore.md](backup-restore.md)), then copy back only the affected rows.
4. **Whole-database replacement** is the last resort: restoring into the live database needs `--truncate --i-understand "OVERWRITE-LIVE-DATABASE"` and a second Super Admin approval of the restore request. Everything written after the backup is lost - decide that knowingly.

## Verification
- Row counts of the affected tables match what you expect.
- Admin > System Health > Data Integrity: run the checks and confirm they pass.
- Spot-check three records end to end (an applicant, a proposal, a payment record).
- `node scripts/smoke.mjs --url https://<site>`.

## Escalation
Owner immediately for any case involving payments, consent records or contact-sharing records (legal evidence).

## Rollback
If the restore itself went wrong: keep the scratch database and the pre-restore state (take a fresh backup before any overwrite). Do not repeat the same restore.

## Post-incident
Write down the cause, the data window lost, and the control that failed. Run a restore drill (Admin > Security Operations > Restore drills) so the next recovery is practised.

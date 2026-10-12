# Runbook: backup and restore

Three independent safety nets exist. Know which one you are using.

| Net | What | How far back | Where |
|---|---|---|---|
| Neon point-in-time | the whole database as of a moment | about 6 hours on the free plan | Neon console > Branches |
| In-app encrypted backup | every table, AES-256-GCM, plus ciphertext copies of private files | daily, retention in System Configuration > Backup Policy | Admin > System Health > Backup & Recovery tab (status view: Security Operations > Backups) |
| `pg_dump` workflow (optional) | a full dump as an encrypted GitHub artifact | 90 days | GitHub > Actions > Database backup (off unless `BACKUP_WORKFLOW_ENABLED=true`) |

## Symptoms (when to use this)
- Backup failed alert, no recent backup in Admin > Security Operations > Backups, a restore is needed, or a restore drill is due.

## Diagnosis - backup did not run
1. Admin > Security Operations > Backups: status of the latest run and its error.
2. The daily backup runs inside the once-a-day Vercel cron (08:00 UTC). Vercel > Logs > filter `/api/cron/notifications`.
3. Common causes: `BACKUP_ENCRYPTION_KEY` missing, the backup store token missing, the database too large for one serverless call (then the run fails loudly - rely on Neon and the `pg_dump` workflow).

## Immediate actions - make a backup now
Admin > System Health > **Backup & Recovery** tab > **Backup database now** (and **Mirror private files now** for photos and documents). It completes with an automatic verification (download, checksum, decrypt, parse, schema check). A backup that has not been verified is not counted as good.

## Restore (always into a scratch database, never straight into production)
1. Create an empty scratch database (Neon: a new branch with **schema only** or a new project) and apply the schema: `DATABASE_URL=<scratch> node scripts/migrate-deploy.mjs`.
2. On a trusted machine, with the key from the password manager:
   `BACKUP_ENCRYPTION_KEY=... npx tsx scripts/restore-backup.ts --file ./backup.lppb --target-url "<scratch connection>"`
3. Check counts and open the application against the scratch database (separate environment).
4. If production itself must be overwritten: submit a restore request in the app (verified backup + typed phrase + password + reason), a **different** Super Admin approves, then add `--truncate --i-understand "OVERWRITE-LIVE-DATABASE"`. Take a fresh backup first.

## Verification
- Row counts per table match the backup manifest printed by the script.
- Admin > System Health > Data Integrity: run the checks and confirm they pass against the restored database.
- Record the exercise: Admin > Security Operations > Restore drills (performer and a different reviewer sign it; it counts only when every checklist item passed).

## Escalation
Owner. The encryption key is the single point of failure for in-app backups: if it is lost, those backups cannot be read. It must be stored in the password manager *and* offline.

## Rollback
A failed restore into scratch changes nothing in production. A failed overwrite: restore the fresh pre-overwrite backup.

## Post-incident
Update the measured RTO (a passed, reviewed drill sets it) and note anything slow or unclear in this runbook.

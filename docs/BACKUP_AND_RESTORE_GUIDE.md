# Backup and restore guide

Read this with *Deployment → Backup and recovery*. This guide covers what the Security Operations screens show and how to **prove** that a restore works.

## What is backed up

| Layer | How | Where |
|---|---|---|
| Database (logical) | Once a day in the daily job, and on demand: every table is exported through the data model, compressed, **encrypted with AES-256-GCM** (key `BACKUP_ENCRYPTION_KEY`, separate from the sign-in secret) and stored. | The backup object store (preferably a *separate* store via `BACKUP_BLOB_READ_WRITE_TOKEN`) |
| Files | Photos, documents and case evidence are mirrored **as ciphertext**, incrementally. | The backup object store |
| Database (platform) | Point-in-time recovery in the database provider's console. | **Manual** — enable and test it there |

Honest limits: the logical export is a one-pass snapshot (not point-in-time consistent under concurrent writes) bounded by size and time. If the database is too large for one serverless invocation the run **fails loudly** — it never produces a silent partial backup — and the provider's point-in-time recovery must be used.

## What "healthy" means on the Backups screen

The status is computed from the backup records, never assumed:

| Status | Meaning |
|---|---|
| **HEALTHY** | The latest database backup **completed**, **passed its integrity verification**, and is younger than the stale limit (default 48 h). |
| **WARNING** | Completed but **not yet verified**, or older than the limit. |
| **FAILED** | The latest attempt failed, or the latest backup **failed verification**. |
| **NONE** | No completed database backup exists. |
| **DISABLED** | Backups are switched off in System Control. |

The screen never shows where a backup is stored or any key — only whether it is encrypted, stored off-site, and in a separate store.

## What a verification proves — and what it does not

A verification downloads the backup, checks its checksum, decrypts it, parses it and compares the per-table row counts with the manifest. That shows the backup is **intact and readable**. It does **not** show that the data can be restored into a running system with working relationships, migrations and sign-in. Only a **restore drill** shows that.

## Deletion protection

Backups are removed only by the retention policy (default: keep 7 daily, 4 weekly, 6 monthly; the newest backup and the newest verified one are always kept). Any other attempt to delete a backup object is **refused**, recorded as a security event and raises a CRITICAL alert. A test pins the single code path allowed to delete.

## Restoring for real (an outage or a decision to roll back)

The application **never overwrites data**. A real restore is a human, audited, two-person procedure:

1. In System Health → Backup & Recovery, **request a restore** (choose a verified backup, type the confirmation phrase, re-enter your password, give a reason).
2. A **different** Super Admin approves it.
3. An operator runs, from a trusted machine:
   ```
   BACKUP_ENCRYPTION_KEY=… npx tsx scripts/restore-backup.ts --file <backup file> --target-url "<empty database url>"
   ```
   The script requires `--target-url`, never defaults to the live database, and refuses to write into the live database unless given `--truncate --i-understand "OVERWRITE-LIVE-DATABASE"`. Without `--truncate` the target tables must already be empty.
4. Run **Post-restore validation** in the app and record the outcome.

## Restore drills — proving it before you need it

A drill rehearses step 3 against a **scratch** database and records the evidence. **Do this at least once, and after any major change.**

**You need:** an empty, isolated Postgres database (for example a Neon *branch* created only for the drill, with the current migrations applied via `prisma migrate deploy`), the backup file, the encryption key, and two administrators.

1. **Security Operations → Restore drills → Start a drill.** Choose a completed database backup, name the isolated environment (it may not contain the words *production, prod, live, primary, main*) and tick the confirmation. The application immediately runs the **automated verification** and records its result.
2. **Restore** into the scratch database with `scripts/restore-backup.ts` as above.
3. **Check and record** each of the eight items on the drill, with a short note of how you checked:
   1. the database restored completely;
   2. photos, documents and evidence files restored and readable;
   3. relationships between records are intact (profiles, proposals, payments, cases);
   4. the restored data is compatible with the current migrations;
   5. the application started against the restored database;
   6. an administrator could sign in against the restored data;
   7. critical workflows worked (open a profile, a proposal, a payment record);
   8. the data integrity checks passed on the restored data.
4. **Complete** the drill. It cannot be completed while any item is *not run*; it **passes only if every item passed and the automated verification passed**; otherwise it is recorded as failed, with what failed.
5. A **different** administrator **reviews and signs off** (approve, or reject with a reason). A drill cannot be reviewed by the person who performed it.

The application does steps 1 and 4–5 itself. Steps 2–3 are done by a named person outside the application — the checklist is that person's **attestation**, and the screen says so. A restore counts as **proven** only when a drill is passed *and* independently approved. The measured recovery time on the Disaster recovery screen is that approved drill's duration.

Never run a drill against the production database. Delete the scratch database when the drill is approved.

## Secrets

`BACKUP_ENCRYPTION_KEY` and the storage tokens live only in the hosting provider's environment settings, never in source code (the security scan checks this). **Keep a copy of the backup key in a safe place that is not the same account as the hosting provider — a backup without its key cannot be restored.** Rotating the key does not re-encrypt old backups: keep old keys until the backups made with them have expired.

## Known limits

- Stored files, including backups, are ciphertext at a public but unguessable address (no API returns it). Private storage would be stronger.
- The daily job is the only schedule on the current hosting plan; a backup is as fresh as the last successful daily run (the *measured RPO* on the recovery screen shows exactly that).

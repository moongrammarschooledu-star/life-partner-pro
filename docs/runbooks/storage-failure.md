# Runbook: storage failure (photos, documents, evidence)

Files live in Vercel Blob. They are stored as **encrypted ciphertext** (AES-256-GCM, key derived from `NEXTAUTH_SECRET`) and are only served through authorised application routes; the Blob address is never shown to anyone.

## Symptoms
- Uploads fail; photos or documents will not open; "could not read file" or integrity errors; Admin > System Health storage check shows down; a storage token expired or the store was deleted.

## Diagnosis
1. Admin > System Health: storage check (token present / reachable). `not_configured` means `BLOB_READ_WRITE_TOKEN` is missing in this environment.
2. Vercel dashboard > Storage > the Blob store: exists, in the right project, quota not exhausted.
3. Vercel status page.
4. Decryption failures for *every* file mean the key changed: was `NEXTAUTH_SECRET` rotated? Restoring the previous value restores access. Failures for *one* file mean that object is damaged or missing.

## Immediate actions
1. Stop new uploads if they are failing noisily: Admin > System Configuration > Emergency > *uploads*. Existing files are untouched.
2. Token missing/expired: create or reconnect the store token in Vercel, set `BLOB_READ_WRITE_TOKEN`, redeploy.
3. Quota: remove nothing by hand; apply the retention policy and review large files; upgrade the plan if needed.
4. Single damaged file: restore it from the private-file mirror in the backup store (the mirror holds ciphertext copies, see [backup-restore.md](backup-restore.md)); otherwise ask the applicant to upload it again and mark the old record for review.

## Verification
- Upload a test photo on a test profile and open it; open an existing document as an administrator.
- Admin > System Health storage OK. No new integrity alerts.

## Escalation
Owner; Vercel support for platform incidents. Missing evidence files belonging to an open case or a legal hold: tell the owner at once.

## Recovery
Re-open the uploads switch. Run the file integrity check (System Health > Data Integrity) to confirm every database record still has a readable file.

## Rollback
Only if a release changed storage code: [rollback.md](rollback.md).

## Post-incident
Which files were affected, whether any were unrecoverable, whether the backup store is separate and current. Move to a **private** Blob store when Vercel offers it for this plan (a known limitation in `GO_LIVE_CHECKLIST.md`).

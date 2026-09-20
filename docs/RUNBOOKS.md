# Operational runbooks

> Generated from `src/lib/ops/runbooks.ts` (also shown in Admin → Runbooks). Do not edit by hand — edit the source and run `npx tsx scripts/render-runbooks.ts`.

## Deployment
Ship a change to staging, then production, with verification at every step.

### Detection
- A new commit merged to the production branch triggers a Vercel deployment.
- The release is auto-registered (LPP-REL-######) the first time an instance of the new build starts.

### Checks
- CI green for the commit: typecheck, lint, tests, security scan, dependency audit, build, migration validation.
- Production Readiness shows no NEW blocking gates.
- A verified backup exists from the last 24 h (System Health → Backup & Recovery).
- Migrations are backward-compatible (expand → migrate → contract); no destructive migration without written approval.

### Authorised actions
- Merge to the protected production branch (needs GitHub branch-protection approval — manual setting).
- SUPER_ADMIN approves the release in Production Readiness → Releases (password re-confirmation).

### Verification
- Release status becomes HEALTHY (database + configuration verified automatically).
- deploy-gate workflow posts SMOKE and SECURITY_SMOKE evidence for the deployed commit.
- System Health overview shows no new errors for 15 minutes.

### Recovery
- If the release is UNHEALTHY or smoke tests fail: stop further deployments and follow the Rollback runbook.

### Audit requirements
- DEPLOYMENT_STARTED / DEPLOYMENT_COMPLETED / DEPLOYMENT_FAILED are written automatically; approval is audited with the approver.

## Rollback
Return to the previous stable release without corrupting data.

### Detection
- Release marked UNHEALTHY, or error-rate / latency alerts fire shortly after a deployment.
- Post-deploy smoke tests fail.

### Checks
- Production Readiness → Releases → the release's Rollback assessment: SAFE / REQUIRES_REVIEW / UNKNOWN.
- REQUIRES_REVIEW means migrations were applied after the target release. Prisma migrations are forward-only — confirm the older code tolerates the newer schema, or restore from a verified backup instead.

### Authorised actions
- SUPER_ADMIN only. In Vercel: promote the previous deployment (manual). Then record the rollback in Production Readiness (password re-confirmation + reason).

### Verification
- Health endpoints green; System Health shows the previous version; no new critical alerts.
- Run data-integrity checks (System Health → Backup & Recovery → Post-restore validation).

### Recovery
- If schema and code are incompatible and the assessment is REQUIRES_REVIEW, switch to the Backup restoration runbook rather than forcing the rollback.

### Audit requirements
- ROLLBACK_STARTED and ROLLBACK_COMPLETED with actor, reason and release code.

## Backup
Create, verify and retain encrypted backups.

### Detection
- Backup failed / stale alerts; last successful backup older than the configured limit.

### Checks
- BACKUP_ENCRYPTION_KEY is configured (never reuse NEXTAUTH_SECRET).
- Backup Policy is enabled and retention counts are what the deployment's legal/operational rules require.
- Optional but recommended: BACKUP_BLOB_READ_WRITE_TOKEN points to a SEPARATE storage account.

### Authorised actions
- Trigger a manual database or file backup (permission system:backup:trigger).
- Scheduled backups run in the daily tick and verify themselves (decrypt → parse → manifest).

### Verification
- Backup shows COMPLETED with verification PASSED.
- File mirror shows every private file copied.

### Recovery
- A failed run explains why. 'Exceeded time/size budget' means the database outgrew the in-app backup: use Neon point-in-time recovery (primary) and the optional pg_dump GitHub workflow.

### Audit requirements
- BACKUP_TRIGGERED and BACKUP_VERIFIED. Backup contents and storage URLs are never shown in any admin interface.

## Backup restoration
Restore data from a verified backup safely. The application never overwrites live data by itself.

### Detection
- Data loss, corruption, failed migration, or security incident requiring recovery.

### Checks
- Pick a backup with verification PASSED. Confirm the target: a scratch database first, production only if unavoidable.
- Freeze writes: set the operational state to MAINTENANCE / RECOVERY.

### Authorised actions
- Request a restore (system:restore:approve + password re-confirmation + typing the exact phrase 'RESTORE <backup code>').
- A DIFFERENT SUPER_ADMIN approves. An operator then runs scripts/restore-backup.ts with the approved request and the backup key (out of app).
- Mark the request executed.

### Verification
- Run 'Post-restore validation' (connectivity, core data sets, integrity checks).
- Log in as an admin, verify permissions, profiles, proposals, payments, audit logs and file access.

### Recovery
- If validation fails, keep MAINTENANCE on, restore into a scratch database and compare before touching production again.

### Audit requirements
- RESTORE_REQUESTED, RESTORE_TRIGGERED (approve / reject / executed / cancel) and the post-restore integrity run.

## Payment outage
Payments failing or the provider is unavailable.

### Detection
- Payment-failure-spike or provider alerts; failed-payments count in System Health → Payments.

### Checks
- Provider health and environment safety (Finance Center → System Health).
- Recent webhook failures and reconciliation mismatches.

### Authorised actions
- SUPER_ADMIN: Finance Center → Rollout → Disable Payments, or the emergency payments switch (System Configuration → Emergency). Both only block NEW checkouts; existing subscriptions, invoices and refunds are untouched.

### Verification
- Applicants see the neutral 'Online payments are temporarily unavailable' message; no new orders are created.

### Recovery
- Fix the provider/credentials, run reconciliation, then re-enable through the rollout stages (never skipping stages).

### Audit requirements
- PAYMENT_KILL_SWITCH_USED / EMERGENCY_SWITCH_CHANGED with reason.

## Webhook outage
Provider webhooks are failing, delayed or being spoofed.

### Detection
- Webhook failure spike alert; webhook signature counter rising in System Health → Security.

### Checks
- Failed events and stuck RECEIVED events (integrity checks).
- Is STRIPE_WEBHOOK_SECRET current? Is the endpoint URL correct for this environment?

### Authorised actions
- Finance Center → Rollout → toggle 'Provider webhook processing' (intake pauses, provider retries later).
- Run reconciliation to detect payments the provider settled that we missed.

### Verification
- A test event is processed; failed count stops rising.

### Recovery
- Replay missed events from the provider dashboard; duplicates are ignored (idempotency key).

### Audit requirements
- PAYMENT_FEATURE_FLAG_CHANGED; reconciliation run and any incident case.

## Database outage
The database is unreachable or extremely slow.

### Detection
- /api/health/ready returns 503; DATABASE_OUTAGE alert (CRITICAL, auto-opens an incident).

### Checks
- Neon status page and project dashboard (manual).
- Connection string / pooler settings changed recently? Connection limit reached?

### Authorised actions
- Set the operational state to DEGRADED/MAINTENANCE if the admin console is still reachable (it may not be). Otherwise use Vercel to redeploy or Neon to restore a branch/point-in-time (manual).

### Verification
- Ready endpoint 200; System Health database latency normal; run integrity checks.

### Recovery
- If data is damaged: Backup restoration runbook. Prefer Neon point-in-time recovery for near-zero data loss.

### Audit requirements
- Incident case (LPP-INC) with timeline; state changes are audited.

## Storage outage
Photo/document/evidence storage is failing.

### Detection
- Storage-failure alerts; storage error counter in System Health → Storage.

### Checks
- Vercel Blob status (manual); token still valid; account quota.

### Authorised actions
- Emergency uploads switch (System Configuration → Emergency) to stop new uploads while reads keep failing gracefully.

### Verification
- Uploads succeed; existing files stream through their authenticated routes.

### Recovery
- Restore missing objects from the file mirror (ciphertext copies in the backup store) — objects are byte-identical, so they decrypt with the original keys.

### Audit requirements
- EMERGENCY_SWITCH_CHANGED; incident case.

## Notification outage
Email/SMS/WhatsApp delivery is failing.

### Detection
- Failed deliveries by channel in System Health → Communications; queue backlog alert.

### Checks
- Provider credentials and quotas. NOTE: until a real provider is configured, messages (including admin OTP codes) are only written to the server log.

### Authorised actions
- Turn off the affected channel with the notifications / whatsapp feature flag; failed rows are kept and retried automatically (bounded) when re-enabled.

### Verification
- Test send succeeds; failed count returns to zero.

### Recovery
- Use Communication Center → Retry for individual messages; the daily job retries the last 24 h within the retry limit.

### Audit requirements
- FEATURE_FLAG_CHANGED; NOTIFICATION_RETRY_TRIGGERED.

## Account / security incident
Suspected admin account compromise, data exposure or attack.

### Detection
- Failed-login spike, permission-violation spike, unexpected admin activity, security flags.

### Checks
- Audit Log (filter by actor, action, correlation ID); Active Sessions; login history.

### Authorised actions
- Revoke sessions and deactivate the account (Admin Users).
- Rotate secrets (NEXTAUTH_SECRET invalidates ALL sessions and stored files — read the rotation warning first).
- Emergency switches for public access if exposure is ongoing.
- Open a SECURITY incident case; preserve evidence.

### Verification
- No further suspicious activity; alert resolved with a written resolution.

### Recovery
- Follow legal/regulatory notification obligations for the deployment (not encoded in the app).

### Audit requirements
- Everything above is audited; incident case records the timeline.

## Maintenance mode
Take the public site offline cleanly for planned work.

### Detection
- Planned change window.

### Checks
- No payment in flight that would be confused (payments finish; webhooks keep processing).
- Announce the window; choose ON or SCHEDULED.

### Authorised actions
- System Configuration → Maintenance: set mode, optional window and message (password re-confirmation + reason).

### Verification
- Public pages show the neutral maintenance page; admin console, webhooks, cron and health endpoints stay reachable.

### Recovery
- Set mode OFF. If the site does not return, check /api/system-state and the operational state (must be NORMAL).

### Audit requirements
- MAINTENANCE_ENABLED / MAINTENANCE_DISABLED with previous and new values.

## Emergency shutdown
Last resort: stop parts of the system fast. Not a substitute for normal operational controls.

### Detection
- Active attack, data exposure, runaway abuse, or a defect corrupting data.

### Checks
- Can a narrower control solve it? (feature flag, single emergency switch, payment kill switch). Prefer those.

### Authorised actions
- SUPER_ADMIN: System Configuration → Emergency — payments, registrations, profile submissions, matching, proposals, notifications, uploads, or public access; or set the operational state to EMERGENCY (closes everything public at once). Password re-confirmation and a written reason are mandatory.

### Verification
- Affected features return the neutral 503 message; admin console and webhooks stay available.

### Recovery
- Investigate and fix, then re-open switches one at a time; set the state back to NORMAL; close the incident only after validation.

### Audit requirements
- EMERGENCY_SWITCH_CHANGED / OPERATIONAL_STATE_CHANGED with actor, previous value, new value, reason.

# Runbook: database failure (unreachable or very slow)

The application cannot talk to the database. (If it answers but the data is wrong, use [database-recovery.md](database-recovery.md).)

## Symptoms
- `/api/health/ready` fails; pages return errors or the neutral unavailable message; the uptime probe fails; Vercel logs show connection errors or timeouts; Neon console shows the endpoint suspended, over quota or in maintenance.

## Diagnosis
1. Neon status page and Neon console > the project: endpoint state (idle/active), compute limits, storage quota, connection count, recent operations.
2. Vercel > Logs: the error text. `Can't reach database server` = network/endpoint; `too many connections` = pool exhaustion; `timeout` = slow queries or a cold endpoint.
3. Did anything change? A new release, a rotated password, a changed `DATABASE_URL`.
4. Admin > System Health (if you can still sign in): database latency and slow queries.

## Immediate actions
1. **Cold endpoint (free plan)**: the first request after idle can take a few seconds; retry once before treating it as an outage.
2. **Connection exhaustion**: confirm `DATABASE_URL` is the *pooled* host (`-pooler`); the application bounds transactions to 15 seconds and waits at most 5 seconds for a connection. Redeploying the same version recycles the connections.
3. **Quota exceeded** (storage or compute hours): free space (the retention policies already prune old operational rows) or upgrade the plan in Neon.
4. **Wrong or rotated credentials**: put the correct `DATABASE_URL` in Vercel for the right environment, redeploy.
5. Show people something honest: turn on maintenance mode (Admin > System Configuration > Maintenance) if you can sign in, so the public page says so instead of erroring.
6. Do not run migrations or restores while the cause is unknown.

## Verification
- `/api/health/ready` returns OK; `node scripts/smoke.mjs --url https://<site>` passes.
- Admin > System Health: database OK; no growing dead-letter queue.
- Background jobs that failed during the outage are retried (Admin > System Health > Jobs & Cron).

## Escalation
Owner; Neon support for platform-side incidents. Data damage suspected: [database-recovery.md](database-recovery.md).

## Recovery
If the Neon project is lost or corrupted: create a new project, apply migrations (`node scripts/migrate-deploy.mjs` against it), restore the latest verified encrypted backup into it ([backup-restore.md](backup-restore.md)), point `DATABASE_URL` at it in Vercel, redeploy, run Post-restore validation. Expected data loss is bounded by the newest backup (daily, so up to about 24 hours; the measured figure is on the Disaster recovery page).

## Rollback
Switching back to the old database is only possible while it still exists; keep it until the new one has been verified for a day.

## Post-incident
Time to detect, time to recover, data lost; whether the plan size still fits the traffic.

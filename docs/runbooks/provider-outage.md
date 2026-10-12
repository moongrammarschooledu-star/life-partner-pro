# Runbook: provider outage (any outside service)

Life Partner Pro depends on: **Vercel** (hosting and cron), **Neon** (database), **Vercel Blob** (files), **GitHub** (code, checks), the **e-mail provider**, and - only if enabled - SMS, WhatsApp and payment providers. A provider can be down without the application being at fault.

## Symptoms
- Admin > Communications shows a provider as DEGRADED or DOWN; pages load slowly or error; messages stay QUEUED; the uptime probe opened an "Uptime probe failed" issue; the provider's own status page shows an incident.

## Diagnosis
1. Which provider? Admin > System Health lists the checks (application, database, configuration, storage, authentication) and Admin > Communications > provider health shows e-mail/SMS/WhatsApp.
2. Provider status pages: vercel-status, neon status, GitHub status, the e-mail/SMS/WhatsApp provider's status page.
3. Is it only us? A failure of one channel with others healthy points at that provider or our credentials for it.

## What the system does by itself
- **Circuit breaker**: after repeated failures a channel's provider is marked DOWN and skipped for 5 minutes; messages wait (status QUEUED, nothing lost) and the next attempt is scheduled for when the breaker reopens. No attempt is wasted while it is open.
- **Failover**: where a second provider exists for the same channel, messages move to it.
- **Retries with backoff**, then a dead-letter record an administrator can review; messages that wait too long are marked EXPIRED, never silently dropped.
- **Alerts** are raised for a sustained outage.

## Immediate actions
1. Do not change code. Do not "retry everything" by hand.
2. If a provider is flapping and sending is making things worse, switch the channel off: Admin > System Configuration > feature flags `email.enabled`, `sms.enabled`, `whatsapp.enabled` (messages are held while off, nothing is deleted). Sign-in and reset codes are not part of these switches.
3. Tell staff what applicants will notice (delayed messages) and what is safe (everything else).

## Provider-specific pointers
[email-outage.md](email-outage.md), [whatsapp-outage.md](whatsapp-outage.md), [payment-outage.md](payment-outage.md), [database-failure.md](database-failure.md), [storage-failure.md](storage-failure.md), [dns-recovery.md](dns-recovery.md). Vercel itself down: nothing to fix on our side - wait, and post on the status page; the database and backups are unaffected.

## Verification
- Provider health returns to HEALTHY after the next successful send.
- QUEUED messages drain (Admin > Communications > queue).
- Uptime probe green; close the outage issue.

## Escalation
Owner. Open a support ticket with the provider if the outage is not on their status page.

## Recovery
Switch channels back on (if you turned them off), then watch the queue drain. Messages older than the expiry window will not send - that is intended.

## Rollback
Not applicable unless a release caused it - see [rollback.md](rollback.md).

## Post-incident
Duration, what applicants saw, whether failover worked. If one provider is a single point of failure for a channel, record it as an accepted risk or add a second provider.

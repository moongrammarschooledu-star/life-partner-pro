# Platform health (STEP 36)

`/admin/control-center/health` and `GET /api/admin/platform/health` (needs `platform:health:view`) present the existing platform health report in one vocabulary, plus the provider view.

## What is checked

Database round trip, file storage, queue and background jobs, e-mail, payments, authentication (session secret and e-mail codes), webhooks, cron. SMS, WhatsApp, AI and backups appear on the Providers and Deployment pages.

## How it works, honestly

* Checks run **when you open or refresh the page**. There is no continuous monitor behind it, and the page says so. The platform's daily scheduled job and the Security Operations / alerts screens remain the place for ongoing monitoring.
* A figure that cannot be read shows as **Unavailable**; it is never estimated. A check that fails shows its own short, redacted detail.
* Status words: `healthy`, `degraded`, `unavailable`, `not configured`, `connected` (present but never measured).

## Deployment page

Read-only: version, commit, environment, deploy time, migrations applied and the latest one, last backup, last *verified* backup, last restore test and restore drill. No command, deployment or migration can be started from the Control Center. Go-live gates and release approval stay in *Deployment & Go-Live*.

## Public

Visitors see only `/status`, which has no component detail (see `change-management.md`).

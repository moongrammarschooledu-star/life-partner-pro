# Runbooks (STEP 34)

Step-by-step procedures for the situations most likely to happen after launch. Each one has the same parts: **Symptoms, Diagnosis, Immediate actions, Verification, Escalation, Recovery, Rollback, Post-incident**.

| Situation | Runbook |
|---|---|
| Releasing a new version | [deployment.md](deployment.md) |
| A release is bad - go back | [rollback.md](rollback.md) |
| Database damaged or wrong data written | [database-recovery.md](database-recovery.md) |
| Taking and restoring backups | [backup-restore.md](backup-restore.md) |
| Suspected breach or abuse | [security-incident.md](security-incident.md) |
| Any outside service is down | [provider-outage.md](provider-outage.md) |
| Payments misbehave | [payment-outage.md](payment-outage.md) |
| WhatsApp is down or blocked | [whatsapp-outage.md](whatsapp-outage.md) |
| E-mail is not arriving | [email-outage.md](email-outage.md) |
| Database is unreachable | [database-failure.md](database-failure.md) |
| Files or photos will not load or upload | [storage-failure.md](storage-failure.md) |
| The web address stops working | [dns-recovery.md](dns-recovery.md) |

These complement - they do not replace - the in-app runbooks (Admin > Runbooks, source `docs/RUNBOOKS.md`), the disaster-recovery plan kept inside the app (Admin > Security Operations > Disaster recovery) and `docs/INCIDENT_RESPONSE_PLAN.md`.

## Rules that apply to every runbook

1. **Stop the harm first, investigate second.** Use the narrowest switch that works: a feature flag, then one emergency switch (Admin > System Configuration > Emergency), and only then the whole-system `EMERGENCY` state. Switching off never deletes data and can be undone.
2. **Never paste a password, key or connection string** into a chat, ticket or document. Say where it is kept.
3. **Write down what you did and when** (the audit log records the switches; you record the rest in the incident).
4. **Do not enable payments, WhatsApp, SMS or marketing to "see if it helps".** They are off on purpose and only turned on through the go-live process.
5. **One person fixes, another approves** anything that changes security or recovery settings.

## Who to call

The owner is the escalation point for everything (Super Admin). Names, phone numbers and provider support links for this deployment belong in the **recovery contacts** section of the disaster-recovery plan inside the app, not in this repository - a file in git is the wrong place for personal phone numbers. Providers: Vercel (hosting), Neon (database), Vercel Blob (files), GitHub (code and checks), the e-mail provider, and the domain registrar once a custom domain exists.

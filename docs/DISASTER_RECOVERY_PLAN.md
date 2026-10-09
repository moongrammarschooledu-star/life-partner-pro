# Disaster recovery plan

This document describes **how disaster recovery is managed** in Life Partner Pro. The **plan itself** — the actual procedures, dependencies, contacts, failover and rollback steps for this deployment — lives in the application (Security Operations → Disaster recovery), as versioned text approved by someone other than its author. It is deliberately not written here, so it cannot go out of date in a file nobody opens.

## Objectives: configured versus measured

| | Configured (target) | Measured |
|---|---|---|
| **RPO** — how much data may be lost | Set in System Control (default 1440 min = 24 h) | **Age of the newest backup that passed verification** |
| **RTO** — how long recovery may take | Set in System Control (default 240 min = 4 h) | **Duration of the latest restore drill that passed and was independently approved** |

- The configured numbers are **objectives, not guarantees**, and are never shown as achieved. The measured numbers come from real records and show **"Not measured yet"** until there is evidence. A measurement is never filled in from the target.
- The comparison reads **MET** (measured is at or under target), **EXCEEDED**, or **NOT MEASURED**. An exceeded objective makes the readiness verdict *Not ready*; an unmeasured one is a warning.

## The plan

Each version has seven sections, each a list of *title | detail* entries:

1. **Recovery procedures** — ordered steps to restore service.
2. **Infrastructure dependencies** — hosting, database, storage, DNS, e-mail, payment, messaging providers.
3. **Provider dependencies** — what each provider is used for and how to reach their support.
4. **Recovery contacts** — roles and names only.
5. **Failover procedure** — what to switch, in what order.
6. **Rollback procedure** — returning to the previous release safely (see Deployment → Rollback).
7. **Business continuity** — what the team does while the platform is down.

Rules the system enforces:

- A new version is a **draft**; a **different** administrator approves it; approving supersedes the previous version. One draft at a time.
- The plan may name people, roles and providers. **It may not contain a secret.** Anything that looks like a password, key or token is refused — say *where it is kept* (for example "the password manager, vault *Recovery*") instead.
- Every change needs a reason and is audited.

## Testing

The plan carries a **test schedule** in days (7–730). Record each test — a **tabletop** walkthrough, a **restore** (link the restore drill), or a **failover** — with when it happened, how long it took, and what was found. The screen shows the last test, the next one due, and flags an overdue schedule (also a readiness warning). Run a restore drill before relying on any RTO figure.

## Suggested starting content

A starting list, to be adapted — not a statement of what is in place:

- **Procedures:** confirm the incident and open a security incident; pause risky actions with emergency switches; restore from the newest verified backup into a new database branch (or use point-in-time recovery); run post-restore validation; point the application at the restored database; verify sign-in and one workflow; re-enable switches; communicate; write the post-incident review.
- **Infrastructure:** the hosting platform, the managed Postgres database, the object store for files and backups, the domain and DNS provider.
- **Providers:** the e-mail provider, the messaging providers (WhatsApp/SMS), the payment provider, the e-signature provider, the identity-verification provider — each with its support route and what degrades if it is down.
- **Failover/rollback:** promote the previous deployment (hosting console), record the rollback in Production Readiness; schema is forward-only, so check the rollback assessment first.

## Manual configuration the owner must do

- Enable the database provider's **point-in-time recovery** and test it.
- Create a **scratch database** for restore drills and run the first drill (Backup and restore guide).
- Store a copy of `BACKUP_ENCRYPTION_KEY` safely outside the hosting account.
- Write and approve the first plan version; set the test schedule; record the first tabletop test.
- Decide the RPO/RTO targets that match the business, in System Control.

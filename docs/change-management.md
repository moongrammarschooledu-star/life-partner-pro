# Change management (STEP 36)

## Maintenance and read-only mode

Four modes, mapped onto the existing system-control record (no second store):

| Mode | Public / applicants | Administrators |
|---|---|---|
| Normal | Everything works. | Everything works. |
| Scheduled maintenance | Announced ahead on `/status`; at the start time the site shows the maintenance page. | Always reachable. |
| Emergency maintenance | Maintenance page straight away; APIs answer 503 with `Retry-After`. | Always reachable. |
| Read-only | Pages are served; every write (POST, PUT, PATCH, DELETE) is refused with a neutral 503. | Always reachable. |

Never blocked: the admin area, sign-in and sign-out (`/api/auth`, applicant status/sign-in, family sign-in/out), health checks, payment callbacks (`/api/webhooks`), background jobs (`/api/cron`), `/maintenance`, `/status` and `/api/status`. Enforcement is in `src/proxy.ts` using `isBlockedByReadOnly`; the state is cached for 15 seconds and the proxy fails **open** on any error so a monitoring problem cannot become an outage.

Nothing is deleted or queued. Changing the mode needs `platform:maintenance:manage`, a reason, the environment and a fresh password.

## Production change freeze

`platform:change_freeze` can start a freeze (optionally with an end time, at most 30 days) and end it. While it is active, **configuration changes are refused with 423**: settings, flags, kill switches, maintenance, provider switches, rollback, and the older flag and system-control routes. Two ways through, both audited:

1. **Break-glass** held by the administrator making the change.
2. A **restrictive** emergency action (switching something off, read-only on) by someone who holds `platform:change_freeze`. Enabling or widening is never allowed this way.

## Approval

The existing maker-checker gate is used (no new approval engine): `PLATFORM_FEATURE_ACTIVATION`, `PLATFORM_SETTING_HIGH_RISK`, `PLATFORM_CONFIG_ROLLBACK` (domain *Platform*, default level 2, `SUPER_ADMIN`). They appear in the approval policy screen once policies are seeded, and can be turned off or re-levelled there like any other. If a policy is switched off, the change applies immediately; the Control Center says so rather than pretending.

## Announcements

Kinds: maintenance, security notice, service interruption, platform update. Audiences: everyone, applicants, family members, administrators, or a specific administrator role. Each has a window; drafts are never visible; publish, resolve and end are separate actions. Text for any public, applicant, family or status-page audience is rejected if it contains an IP address, file path, stack trace, internal host, connection string, secret, or security-rule detail.

## Public status page

`/status` (and `/api/status`) show only: overall state, a short message, planned maintenance, and notices an administrator marked for the status page (title, text, kind, dates), plus the public contact e-mail and hours if set. They never show internal errors, providers, incidents, who changed what, the operational reason or any identifier (the payload keys are pinned by a test). The page can be switched off in Platform settings. If the status cannot be read the page says so; it does not claim an outage.

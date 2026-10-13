# Super Admin Control Center (STEP 36)

The Control Center (`/admin/control-center`) is a **governance layer** over the platform's existing editors. It does not hold a second copy of anything that already has an editor, a validation rule and an approval path (matching, verification, payments, AI, privacy, security, risk, workflows and so on). For those it shows the **current configuration read-only** and links to the screen where the change is made.

What it owns itself: platform settings, branding and public contact, localization, feature flags and kill switches, the provider view and safe connection tests, maintenance and read-only mode, the production change freeze, break-glass, announcements and the public status page, and the configuration change log with compare and rollback.

See `PLATFORM_CONTROL_AUDIT.md` for the mapping of every section of the brief to REUSE / EXTEND / NEW.

## Where things are

| Area | Screen | Permission to see it |
|---|---|---|
| Overview (platform, security, operations, business, infrastructure, deployment) | `/admin/control-center` | `platform:control_center:view` (each block also needs its own permission) |
| Platform settings (identity, status page) | `/admin/control-center/platform` | `platform:settings:view` |
| Localization | `/admin/control-center/localization` | `platform:settings:view` |
| Branding and public contact | `/admin/control-center/branding` | `platform:branding:view` |
| Feature flags and emergency switches | `/admin/control-center/features` | `platform:features:view` |
| Providers | `/admin/control-center/providers` | `platform:providers:view` |
| Maintenance, change freeze, break-glass | `/admin/control-center/maintenance` | `platform:maintenance:view` |
| Announcements | `/admin/control-center/announcements` | `platform:announcements:view` |
| Configuration history | `/admin/control-center/configuration-history` | `platform:configuration:view` |
| System health | `/admin/control-center/health` | `platform:health:view` |
| Deployment (read-only) | `/admin/control-center/deployment` | `platform:deployment:view` |
| Section hubs (matching, verification, communication, approvals, payments, AI, privacy, security, …) | `/admin/control-center/<section>` | `platform:control_center:view` **and** the section's own permission |
| Public status | `/status` | public |

## Principles

* **The server decides.** Every screen only hides what the server would refuse. Each API route calls `requireAdmin(<platform permission>)`; the settings, flag and kill-switch routes accept any signed-in administrator only to re-check the exact permission inside the service.
* **Environment is named.** Every change must name the environment (development / staging / production) and the server refuses it unless that is the environment it is running in. The screen shows the environment on every page and asks you to type it.
* **Reason, password, history.** A change needs a written reason, a fresh password confirmation, and writes one append-only entry to the configuration change log (kind, key, version, who, session, why, approval, environment, redacted before/after). Nothing updates or deletes a log row.
* **Approvals.** High-risk changes use the existing maker-checker gate: enabling a *sensitive* feature in production (`PLATFORM_FEATURE_ACTIVATION`), changing a high-risk setting (`PLATFORM_SETTING_HIGH_RISK`), and rollback (`PLATFORM_CONFIG_ROLLBACK`). Whether approval is actually required is controlled by the approval policy, like every other approval. Switching something **off** never needs approval.
* **No secrets.** Settings cannot hold a secret (a value that looks like one is refused). Providers show status and last test, never a credential or a credential name. History and export redact secret-looking keys and values.
* **No console.** There is no SQL console, no shell, no file browser and no arbitrary-prompt runner. A test (`platform-security.test.ts`) fails if the Control Center code uses raw SQL, `child_process`, `eval` or `dangerouslySetInnerHTML`.

## Permissions (23)

`platform:control_center:view`, `platform:settings:view|manage`, `platform:features:view|manage`, `platform:providers:view|manage`, `platform:branding:view|manage`, `platform:workflows:view|manage`, `platform:maintenance:view|manage`, `platform:deployment:view`, `platform:health:view`, `platform:configuration:view|manage|rollback`, `platform:audit:view`, `platform:break_glass`, `platform:change_freeze`, `platform:announcements:view|manage`.

* `SUPER_ADMIN` holds all of them.
* `OPERATIONS_ADMIN` holds view permissions for the overview, settings, features, providers, workflows, maintenance, deployment, health and announcements.
* `COMPLIANCE_MANAGER` holds view permissions for the overview, settings, features, configuration history, audit and announcements.
* No other role holds any platform permission. Break-glass, change freeze, rollback, provider management and settings management are *sensitive* permissions.

The names follow the repository's `module:action` form (`platform:settings:view`) rather than the brief's `platform.settings.view`.

## What is deliberately not here

* A translation editor (English and Urdu text lives in the application).
* Logo / image upload.
* Configuration import (export exists and is safe metadata only).
* Switches for CRM, family portal, advanced search, risk automation, security automation and PWA: the application does not check such switches, so they are listed read-only as "not enforced yet" instead of shipping dead toggles.

## Related documents

`feature-flags.md`, `provider-management.md`, `configuration-management.md`, `change-management.md`, `break-glass.md`, `platform-health.md`, `STEP_36_REPORT.md`.

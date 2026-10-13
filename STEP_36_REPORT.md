# STEP 36 Report — Super Admin Control Center

Status: **implemented and tested locally on branch `feat/step36-control-center`; not yet committed, merged or deployed.** The first part (the settings mass-assignment fix) is already live (PR #22, `61bb7a4`). Nothing below has been verified on the live site yet; the "Live check still to do" list says what remains. Every number is from a local run on 2026-10-13.

## Final status

| Area | Status |
|---|---|
| Control Center dashboard | **Built.** Platform, security, operations, business, infrastructure, deployment blocks; each computed only if the caller holds that block's permission; a figure that cannot be read says "Unavailable" |
| Section hubs (matching, verification, communication, approvals, payments, AI, privacy, security, risk, workflows, documents, support, backup, legal, …) | **Built, read-only.** Current configuration plus links to the area's own editor. Not editable here on purpose |
| Platform settings / localization / branding & contact | **Built.** 21 typed settings, versioned, environment-named, secret-rejecting |
| Feature flags | **Built.** 5 states, percentage + group rollout, no personal-attribute targeting, approval for sensitive flags switched on in production |
| Emergency kill switches | **Built.** 9 operated here (registration, matching, proposals, contact sharing, payments, WhatsApp, SMS, e-mail, marketing); AI links to its own approval workflow |
| Providers | **Built.** One status vocabulary, safe read-only tests (rate limited, 5 s timeout), history; communication providers can be switched on/off |
| Maintenance / read-only | **Built.** Four modes; read-only enforced in `proxy.ts` (writes by public/applicants/family refused with 503) |
| Change freeze / break-glass | **Built.** Freeze blocks changes (423); break-glass is time-limited (5–60 min), per person, reviewed by a different administrator |
| Announcements + public status page | **Built.** `/status`, `/api/status`; public text screened for internal detail |
| Configuration history, compare, rollback | **Built.** Append-only; rollback for settings and feature flags only |
| Search / export | **Built.** Search never touches stored values; export is safe metadata only; **no import** |
| Permissions | **23 `platform:*` permissions**; SUPER_ADMIN all; OPERATIONS_ADMIN and COMPLIANCE_MANAGER view-only; nobody else |
| Approvals | 3 new actions in the existing gate (`PLATFORM_FEATURE_ACTIVATION`, `PLATFORM_SETTING_HIGH_RISK`, `PLATFORM_CONFIG_ROLLBACK`) |
| Docs | `PLATFORM_CONTROL_AUDIT.md`, `docs/platform-control-center.md`, `feature-flags.md`, `provider-management.md`, `configuration-management.md`, `change-management.md`, `break-glass.md`, `platform-health.md`, CHANGELOG |

## Tests and gates (local)

* Full suite: **226 files, 2847 tests; 2846 passed, 1 failed** on the first full run. The failure was the route-map document check (the new `/status` page was not listed in `PUBLIC_ROUTE_MAP.md`); fixed, and the public-site tests (66) and the platform, route-coverage and ops tests (221) were re-run and pass. The *whole* suite was not run a second time after that one-line fix.
* New tests: **83** in 3 files — `platform-rules.test.ts` (39: typed values, secret rejection, flag evaluation and targeting, freeze and break-glass rules, announcement safety, status payload keys, environment naming, read-only enforcement, permission model), `platform-security.test.ts` (18: every route guarded, no actor from the request body, exports only handlers, re-authentication on every state-changing route, no raw SQL / shell / eval, no env reads, staff roles hold nothing, sensitive permissions marked, change log append-only), `platform-flow.test.ts` (26: settings, freeze, break-glass, flags, approval gate, rollback abuse, announcements, provider no-leak, change-log redaction and paging) over the in-memory database.
* `tsc --noEmit`: clean. `eslint`: 0 errors (48 warnings, none in new code). `check-migrations`: 38 migrations valid. `security-scan`: PASS. `audit-routes`: 0 critical, 0 high, 8 medium (the same class as before; none are new Control Center routes after the final fix).
* **Not run:** a production build (`next build` takes ~35 minutes locally; the Vercel build is the build check), browser tests of the new screens, load tests.

## Known gaps and honest limits

* **Screens not yet exercised in a browser.** They type-check and lint and their APIs are tested, but no one has clicked them. The live check below is the real test.
* **No translation editor, no logo/image upload, no configuration import.** Export exists.
* **Six flags from the brief are not enforced by the application** (CRM, family portal, advanced search, risk automation, security automation, PWA) so they are shown read-only as "not enforced yet" rather than as switches that do nothing.
* **Rollback covers settings and feature flags only.** Maintenance, freeze and emergency-switch changes are reversed by making the opposite change.
* **Approval policies** for the 3 new actions are created when policies are seeded (the Approvals screen). Until then the change applies without a second approver and the Approvals hub says the policies are missing.
* **Health is on-demand**, not continuous monitoring. Announcement *banners* inside the applicant and admin screens are not built; announcements show on `/status` and through `activeAnnouncementsFor`, which the screens can adopt.
* **Per-instance cache**: a flag or setting change reaches all server instances within about 30 seconds.
* The brief's permission names (`platform.settings.view`) are implemented in the repository's form (`platform:settings:view`).

## Blockers

None for merging. Nothing was changed on the live site yet.

## Remaining manual configuration (owner)

1. Review and merge the pull request (Merge click is yours; CI `verify` must be green).
2. After deploy, open **Approvals → policies** once so the three platform policies are created, and decide whether each should require a second approver.
3. Enter the real **public contact details** (e-mail, phone, WhatsApp, address, support hours) in Control Center → Branding. Until then `/contact` and `/status` show none.
4. Decide the status page message wording, and whether the status page stays on.

## Live check still to do (after merge)

Migrations applied; `/admin/control-center` and each page open for SUPER_ADMIN and are refused for a role without the permission; `/status` public and noindex; a harmless setting change + rollback with cleanup; a feature flag change; a provider test; read-only mode switched on and off again (with sign-in still working); change freeze on/off; one break-glass cycle with review; announcement draft → publish → end. Each is reversed afterwards.

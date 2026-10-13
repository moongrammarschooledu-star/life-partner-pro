# Changelog

All notable changes to Life Partner Pro. Versions follow `MAJOR.MINOR.PATCH` (semantic versioning): **MAJOR** a change that breaks existing data or behaviour, **MINOR** a new capability, **PATCH** a fix. A release candidate is `-rc.N`. The running version is shown in Admin > Deployment & Go-Live together with the commit, the deploy time and the latest database migration; each deployed build is also recorded as a release (`LPP-REL-######`).

Rule for contributors: every pull request that changes behaviour adds a line under **Unreleased**; the owner turns **Unreleased** into a version when launching. `1.0.0` is cut only after the go-live approval gate reaches LIVE.

## Unreleased

### Added (STEP 37: mobile apps, push notifications, deep links)
- Android and iPhone apps as a native shell (Capacitor 7) around the website, in `mobile/`: the same sign-in, API and permissions, no second backend. Hardened Android project (no backup, no plain-text traffic, one exported component, exact App Links, shrunk release build, signing only from the build environment) and iOS project (push and Universal Links entitlements, permission strings, no arbitrary loads).
- Registered devices (`MobileDevice`): "Your devices & notifications" in Account Settings and the family Security page; remove a device to sign it out and delete its push token.
- Push notifications (off by default, flag `mobile.push.enabled`): FCM and APNs providers, privacy-safe text (private by default; Full / Private / Minimal / Off), quiet hours, preferences, a cap per device per hour, encrypted push tokens, delivery history.
- Deep links: an approved-routes list, a server-side resolver that answers "not found" for anything the person may not open, `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` (empty until configured).
- App version policy (minimum / recommended / latest per platform) with an update screen, a release log with an approval gate for production, and Control Center → Mobile apps (versions, devices, push health, links, releases, errors, usage).
- Nine `mobile.*` feature flags; anonymous app usage counts (off unless enabled); offline notice for the website and the apps; crash reports tagged with platform and app version.
- A public page `/delete-account` describing how to delete an account (linked from the footer and the store listings).
- Membership checkout started from inside the app is refused until `mobile.payments.enabled` is on.
- CI workflow `mobile.yml` (builds and validates the Android bundle, compiles the iPhone app, optionally archives it; publishes nothing). Documents in `docs/mobile/` and `MOBILE_PRODUCTION_READINESS.md`.
- Migrations (additive): mobile enum values, then the mobile tables.

### Changed (STEP 37)
- A notification mirrored to the person's phone is created after the in-app notification and never affects it.
- A public push path or deep link can never be anything but a plain in-app route.

### Added (STEP 36: Super Admin Control Center)
- Control Center at Admin > Control Center: overview (platform, security, operations, business, infrastructure, deployment; each block only for the permissions held), read-only hubs for areas that keep their own editors, and its own pages for platform settings, localization, branding and public contact, feature flags, providers, maintenance, announcements, configuration history, system health and deployment.
- Feature flag states (enabled, disabled, rollout, paused, emergency-disabled) with percentage and group rollout; an emergency kill-switch panel; an honest list of flags the application does not enforce yet.
- Provider view in one status vocabulary with safe, rate-limited, read-only connection tests; no credential is ever shown.
- Maintenance modes including read-only mode, production change freeze, and time-limited platform break-glass with review by a different administrator.
- Announcements by audience and a public status page (/status, /api/status); the Contact page shows public contact details once an administrator enters them.
- Append-only configuration change log with compare and rollback (settings and feature flags), safe search and safe export (no import).
- 23 platform:* permissions; approval actions PLATFORM_FEATURE_ACTIVATION, PLATFORM_SETTING_HIGH_RISK, PLATFORM_CONFIG_ROLLBACK.
- Documents: PLATFORM_CONTROL_AUDIT.md, docs/platform-control-center.md, feature-flags.md, provider-management.md, configuration-management.md, change-management.md, break-glass.md, platform-health.md, STEP_36_REPORT.md.
- Migrations (additive): platform enums, then platform tables and flag state/rollout columns.

### Changed (STEP 36)
- PATCH /api/admin/settings only accepts an allow-listed set of fields (previously any column could be written); payment, rollout, membership and reconciliation settings are managed in their own screens.
- The older feature-flag and system-control routes now also respect the change freeze and write to the configuration history.
- Read-only mode refuses writes by the public and applicants with a neutral 503 while pages stay viewable.

### Added (STEP 35: public website, SEO, content, PWA, acquisition)
- Public pages: About, Why Life Partner Pro, For Applicants, For Families, Verification, Safety, FAQ, Contact, Login, Trouble signing in, Offline; the home page, How It Works (twelve steps), Pricing, Privacy Policy and Terms were rewritten. Every page's title, description, canonical URL, Open Graph and indexing come from one registry (`src/lib/public-site/routes.ts`).
- Navigation with a working mobile menu and a skip link; staff/admin links removed from public pages.
- SEO: dynamic `sitemap.xml` (indexable pages, live blog/guides, opted-in landing pages), complete `robots.txt`, `X-Robots-Tag: noindex` on every private area, JSON-LD (Organization, WebSite, WebPage, BreadcrumbList, FAQPage, Article), default social image.
- Blog and Guides with an admin editor (Admin > Blog & Guides): draft, review, scheduled, published, archived; authors, categories, tags; safe Markdown subset; content-policy check before publishing; permissions `content:view|create|edit|publish|archive|delete`; optional second-person review (flag `content.approval_required`, off by default).
- PWA: web app manifest, icons, dismissible install suggestion, service worker that caches only public static files (never pages, API responses or private data) and an offline page.
- Contact and support form: category, consent line, honeypot, duplicate guard; the admin support list shows the category.
- Registration: live completion percentage, privacy statement and privacy notes at the family, income and photo steps.
- Anonymous visitor counting (flag `marketing.site_events.enabled`, off by default; honours Do Not Track / Global Privacy Control) and Admin > Public Website (funnel and site checks).
- Documents: `PUBLIC_WEBSITE_AUDIT.md`, `PUBLIC_ROUTE_MAP.md`, `SEO_IMPLEMENTATION.md`, `APPLICANT_ONBOARDING.md`. New settings `LEGAL_PAGES_REVIEWED`, `LEGAL_GOVERNING_LAW`.
- Migrations (all additive): `ORDER_CANCELLED` audit value, support category and consent columns, content tables and audit values, marketing-event path column.

### Changed (STEP 35)
- The privacy policy no longer says data is never shared with third parties (service providers are named generically); marketing copy no longer says every profile is verified.
- The support page no longer shows example phone, WhatsApp and e-mail channels or opening hours that were not configured.
- Removed 1.1 MB of unused public images and shrank the logo.

### Added
- Order cancellation by an applicant now writes an `ORDER_CANCELLED` audit row.

### Changed
- Readiness: while payments are off (rollout stage DISABLED and the master switch off), the payment-provider, sandbox-checklist, reconciliation, refund and kill-switch gates are advisory warnings instead of launch blockers. They become required again the moment payments are switched on or the rollout stage leaves DISABLED; the payment-environment safety gate is always required.

### Fixed
- The daily tick no longer fails when the settings row does not exist yet (scheduled payment reconciliation and the rollout-stage change now upsert).

## 1.0.0-rc.1 - STEP 34: production deployment and go-live system (not yet released)

### Added
- Go-live approval gate: `GO_LIVE_BLOCKED -> GO_LIVE_READY -> GO_LIVE_APPROVED -> LIVE`. Readiness gates must pass, a **different** administrator approves, the judged build must be the running build, every step is audited and recorded (`/admin/deployment`, `/api/admin/go-live`, permission `golive:manage`).
- Deployment dashboard: version, commit, deploy time, previous release, latest migration, health, latest backup, restore test and drill, emergency switches and feature flags (`/admin/deployment`, `/api/admin/deployment`).
- Emergency switch for **contact sharing** (stops new shares; nothing deleted). Feature flags `sms.enabled` and `email.enabled` (hold messages per channel; sign-in and reset codes are not affected).
- Provider **circuit breaker** in the communications system (a provider that is DOWN is skipped for 5 minutes; messages wait, no attempt is wasted).
- `publicUrl()`: every emailed link uses the canonical https address; production refuses to build a link without one.
- `assertSeedAllowed()`: demo data can never be seeded into production or any database not clearly labelled development.
- `scripts/deploy-db.sh` (backup proof, validate, migrate, integrity, wait, smoke), `.github/workflows/uptime.yml` (probe every 15 minutes, HSTS and certificate checks, one outage issue).
- Runbooks in `docs/runbooks/` (12), `GO_LIVE_CHECKLIST.md`, `DEPLOYMENT_AUDIT.md`, `FINAL_DEPLOYMENT_REPORT.md`, `docs/ENVIRONMENT_VARIABLES.md`.

### Changed
- Prisma interactive transactions are bounded (5 s wait for a connection, 15 s limit).
- `.env.example` lists every variable the code reads (names only).
- Version `0.1.0` -> `1.0.0-rc.1`.

### Database
- `20261012100000_step34_contact_sharing_switch` (one column, default off), `20261012105000_step34_go_live_audit_enum` (four audit actions), `20261012110000_step34_go_live_gate` (two new tables). All additive.

## STEP 33 - final production audit (merged, deployed `8faa650`)
- Applicant sign-in now needs a one-time code e-mailed to the profile's address; session id cookie required; assignment gates on profile sub-routes; phone-search oracle closed; refund and manual-payment compare-and-set; proposal response and contact consent status guards; standing route-audit guards.

## STEP 32 - Security Operations Center
- Detection rules (versioned), alerts and incidents with escalation and containment approval, admin-security view, restore drills with independent review, disaster-recovery plan with configured-versus-measured RPO/RTO, SOC configuration versions and access log.

## STEP 31 - Analytics and BI (`060184e`)
- Metric catalog, data marts, KPIs, dashboards, reports, alerts, forecasts (all behind flags, default off).

## STEP 30 - Engagement system (`855e041`)
- Journey and next actions, workflows, reminders, announcements, feedback, loyalty (flags default off).

## STEP 29 - Marketing and lead generation (`a1898c2`)
- Campaigns, landing pages, lead capture, provider sync, automation, conversion API (flags default off).

## STEP 28 - CRM and lead lifecycle (`6545589`)
## STEP 27 - Membership, entitlements, coupons, referrals, promotions (`c08f210`)
## STEP 26 - Document management, e-signature, lifecycle (`ef565c4`)
## STEP 25 - Communication system: e-mail, SMS, WhatsApp (`897b8d1`)
## STEP 24 - Fraud, risk and safety (`a5eccc8`)
## STEP 23 (+ add-on) - KYC, duplicate detection, legal and compliance framework
## STEP 22 - Family and guardian portal
## STEP 21 - Applicant dashboard
## STEP 20 - Candidate discovery
## STEP 19 - Approval and governance (maker-checker)
## STEP 18 - Workflow and tasks
## STEP 17 - Roles and permissions
## STEP 16 - AI assistant (`73b28fb`, disabled by default)
## STEP 15 - Production readiness: environments, migrations, releases, readiness gates, backups, monitoring, CI
## STEPs 1-14 - Platform foundation: registration, profiles, verification, matching, proposals, meetings, finance, reports, admin console

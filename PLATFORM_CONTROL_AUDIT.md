# Platform Control Center Audit and Plan (STEP 36)

Written before any code. Source: a read of `main` at `f306dc1`. Verdicts: **REUSE** (exists, link to it / call its service), **EXTEND** (exists, add what is missing), **NEW** (does not exist).

## 1. What already exists

| Capability | Where | State |
|---|---|---|
| Feature flags | `FeatureFlag` (key, enabled), registry `ops/feature-flag-defs.ts` (~60 flags), evaluation `ops/feature-flags.ts` (30 s cache, DB failure → registry default), admin API `/api/admin/system/flags` (reason required, audited `FEATURE_FLAG_CHANGED`) | Boolean only: no states, no rollout/targeting, no versions, no approval |
| Emergency switches + maintenance + thresholds | `SystemControl` singleton, `ops/system-control.ts`, `control-schema.ts`, `/api/admin/system/control` (sections, per-section permission, password re-confirmation for high-risk, audited), `ops/guards.ts` (`blockedResponse`), `proxy.ts` (maintenance/emergency → 503 for public traffic) | 9 switches, `OFF/ON/SCHEDULED` maintenance, operational state. **No read-only mode**, no change history/diff |
| Settings | `AppSettings` (matching weights, thresholds, hard requirements, OTP, notification switches, payment rollout) + `/admin/settings` | Typed columns, no versions. Weight total is **not** validated to 100 |
| Providers | Communications: `CommunicationProvider` (health, failover priority, secret *names* only), `probeProvider`, `provider-health.ts`, circuit breaker. Payments: `finance/providers` registry (MANUAL, STRIPE), rollout system with approvals. AI: `AiConfig` + history, kill switch. Marketing: `MarketingProviderConnection`. Database health: `checkDatabase`. Storage: Vercel Blob token | No single place that lists every provider with one status vocabulary and safe test |
| Approvals | `ApprovalPolicy` catalog (`approvals/catalog.ts`, ~90 action types, domains), `enforceApprovalGate`, maker ≠ checker, levels 1–5 | Complete. No platform-configuration action types yet |
| Audit | `AuditLog` via `writeAudit` (admin id, IP, user agent, correlation id), `/admin/audit-log` | Complete for actions; no before/after **configuration** history |
| Break-glass | `BreakGlassAccess` (record-level: CONTACT/CASE only) | Not a platform/configuration capability |
| Health / deployment / readiness / go-live | `/admin/system-health`, `/admin/deployment`, `/admin/production-readiness`, `ops/health.ts`, runbooks | Complete (STEP 15/32/34) |
| Security configuration | STEP 32 `SocSettings` + `SocConfigVersion` (versioned), rate-limit policies, 2FA settings, session policy | Own screens |
| Privacy / retention / legal | `RetentionPolicy`, STEP 23 jurisdiction/compliance, privacy center | Own screens |
| Public status page | none (only `/maintenance`, `/api/health`, `/api/system-state`) | NEW |
| Announcements | `EngagementAnnouncement` (applicant engagement banners, lifecycle audiences) | Different purpose (not roles, not status page) |
| Content / CMS | STEP 35 `/admin/content`, `/admin/public-site` | REUSE |

## 2. Design decisions (disclosed up front)

1. **A governance layer, not a second configuration store.** Every domain (matching, verification, proposals, family, communication, CRM, marketing, membership, payments, AI, analytics, workflows, approvals, risk, privacy, retention, legal, documents, SOC) already has its authoritative editor, services, approvals and tests. The Control Center lists each one, shows a **read-only summary of its current configuration** and links to it (permission-checked). Building a second editor for each would create two sources of truth.
2. **New code owns only what is missing:** typed/versioned **platform settings**, **feature-flag states, rollout and targeting, with versions**, one **configuration change log** (history, diff, rollback), **provider status and safe test**, **maintenance read-only mode**, **change freeze**, **platform break-glass**, **announcements and the public status page**, the **dashboard** and the **section hubs**.
3. **Existing write paths join the history.** `/api/admin/system/flags` and `/api/admin/system/control` keep their permissions and behaviour but now also record into the change log, so history is complete whichever screen was used.
4. **Permissions** use the repository's `module:action` form (STEP 17): `platform:settings:view` for the brief's `platform.settings.view`, and so on. SUPER_ADMIN holds all; other roles get read-only subsets only. Existing `system:*` permissions keep working.
5. **High-risk rule:** *enabling* a sensitive feature flag in production, rolling back high-risk configuration, and overriding a change freeze go through `enforceApprovalGate` with new action types (policy-controlled, like every other approval). *Disabling* a feature is never blocked by approval (kill-switch semantics), but always needs a reason.
6. **Honest flag list.** The brief names flags that have no enforcement in the application today (`family.enabled`, `advanced-search.enabled`, `crm.enabled`, `risk-automation.enabled`, `security-automation.enabled`, `pwa.enabled`). They are listed as **"Not enforced by the application yet"** and cannot be toggled, rather than shipping switches that do nothing. `contact-sharing.enabled` and `registration.enabled` map to the existing emergency switch and `registrations.enabled`.
7. **Provider changes stay in the existing editors** (they already carry approvals). The Control Center adds status, safe test connection (read-only, rate limited, no secret ever returned or logged) and links.
8. **Environment separation:** each deployment has its own database, so staging cannot edit production. Every write requires the caller to name the environment and the server rejects a mismatch; the UI shows the environment on every page.
9. **No SQL console, no shell, no arbitrary filesystem access, no secret values** anywhere (tested).

## 3. Mapping of the brief

| § | Topic | Verdict | Notes |
|---|---|---|---|
| 1–3 | Control Center, dashboard, navigation | NEW | `/admin/control-center`, sections filtered by permission |
| 4–6 | Platform settings, types, versioning | NEW | `PlatformSetting` + change log; types STRING…SECRET_REFERENCE (a reference **name**, never a value) |
| 7–9 | Feature flags, targeting, states | EXTEND | new columns on `FeatureFlag`; rollout by percentage, role, admin, country, environment. No sensitive-attribute targeting |
| 10 | Emergency kill switches | REUSE/EXTEND | existing 9 switches + AI kill switch + payment kill switch surfaced in one panel; AI/marketing/WhatsApp/SMS/e-mail map to their flags |
| 11, 49 | Maintenance | EXTEND | adds READ_ONLY and a unified view. Admin area and recovery paths are always exempt (already the case) |
| 12–21 | Providers (+ e-mail, SMS, WhatsApp, payments, AI) | NEW view over existing | status vocabulary, safe test, health history; edits via existing editors |
| 22–23 | Matching configuration and safety | REUSE + FIX | weights total validation added where missing; strict schema test that forbids attractiveness/facial/sensitive-inference fields |
| 24–31 | Verification, proposals, family, communication, notifications, CRM, marketing, membership | REUSE | hubs with live summaries |
| 32 | Payment rollout | REUSE | existing rollout + approvals |
| 33–34 | Workflows, approval policies | REUSE | hubs |
| 35–36, 40 | Security, privacy, SOC configuration | REUSE | hubs (STEP 32 versioning kept) |
| 37–38 | Retention, compliance | REUSE | hubs with counts |
| 39 | Risk configuration | REUSE | hub |
| 41–42 | Document, analytics configuration | REUSE | hubs |
| 43–44 | Localization, branding | EXTEND (partial) | typed settings for languages/formats and branding text/colours/links. **Gaps:** translation-string editing and secure logo/favicon upload are not built (assets stay in the repository) |
| 45 | Public content | REUSE | STEP 35 |
| 46 | System e-mail templates | REUSE | existing template editor with approval |
| 47–48 | Health, deployment | REUSE | one page each, no commands |
| 50–52 | Audit, history/diff, rollback | NEW | `PlatformConfigChange` (id, kind, key, version, before, after, actor, reason, approval, session, environment); rollback creates a new version, never edits history |
| 53 | Search | NEW | by key, category, provider, feature, environment, status; secret values are never indexed |
| 54 | Import/export | PARTIAL | **export of safe metadata only**; import is not built (the brief says "if implemented") |
| 55 | Environment separation | NEW | see decision 8 |
| 56 | Change freeze | NEW | blocks normal changes; emergency changes need break-glass |
| 57 | Break-glass | NEW (platform scope) | time-limited, step-up, reason, enhanced audit, review by a different Super Admin; never changes the administrator's role |
| 58–59 | Announcements, `/status` | NEW | public status shows safe text only |
| 60 | Permissions | NEW | mapped to `platform:*` |
| 61 | Tables | NEW (minimal) | reuse existing where equivalent; no duplicates |
| 63 | API | NEW/REUSE | listed in `docs/platform-control-center.md` |
| 64–65 | Security and high-risk tests | NEW | automated |
| 66–67 | No SQL / shell | by design | tested |
| 68 | Performance | NEW | cursor pagination, indexes, no unbounded reads |

## 4. Not claimed

No new external provider is connected. No translation editor, no asset upload, no configuration import. Flags without enforcement stay read-only. Anything marked REUSE is as complete (or incomplete) as its original step.

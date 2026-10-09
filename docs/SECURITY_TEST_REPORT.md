# Security test report — STEP 32

Date of run: 2026-10-09. Branch `step32-security-operations-center`. Environment: local development machine; no deployment, no live database was used by the tests.

## Results

| Check | Command | Result |
|---|---|---|
| Type check | `npx tsc --noEmit` | **0 errors** |
| Lint | `npx eslint src scripts --quiet` | **0 errors** |
| Automated tests (whole repository) | `npx vitest run` | **194 files / 2417 tests, all passing** (baseline before this step: 186 files / 2217 tests; this step added 8 files / 200 tests) |
| Static security scan | `node scripts/security-scan.mjs` | **PASS** (HSTS, CSP, no `--accept-data-loss`, no `db push` in the build, no debug env, TLS verification never disabled, no `dangerouslySetInnerHTML` / `eval` / unsafe raw SQL) |
| Dependency audit | `node scripts/deps-audit.mjs` | **PASS** (3 high advisories are reviewed exceptions already on the allow-list; none new) |
| Migration check | `node scripts/check-migrations.mjs` | **26 migrations validated** (the two new ones are additive; the enum additions are in a migration *earlier* than the tables, avoiding the Postgres "unsafe use of new enum value" error) |
| Production build | — | Not run locally for this step (about 35 minutes on the development machine). The deployment platform builds the same commit and is the build check when the owner approves a deploy. |

## The 200 new tests

| File | Tests | What it covers |
|---|---|---|
| `soc-events.test.ts` | 23 | Which facts become security events and what they carry (identifiers and counts only); the audit-writer mirror; rate-limit flood does not become a write flood; prompt-injection and restricted-action detectors record a pattern code, never the text; backup deletion outside the retention policy is refused; every inbound webhook reports a failed signature |
| `soc-rules.test.ts` | 31 | The rule catalog (25 rules, neutral wording, real event types, protected set); rolling-window and distinct-key engine; threshold edges; version policy (what counts as weakening); the alert state machine; escalation timing; configuration validation |
| `soc-flow.test.ts` | 26 | Events → alerts end to end; no duplicates on re-run; suppression after closing; alert lifecycle rules (no skipped steps, resolution text required); assignment limited to people who can work alerts; escalation tiers; versioned rules with a second reviewer (proposer cannot approve); dry run writes nothing; configuration versions; audit entries are scrubbed of secrets |
| `soc-incidents.test.ts` | 18 | Incident numbering and linking; the eight stages and what each requires; evidence as pointers only; containment: narrow runs at once, broad waits for a different approver, nobody approves or is the target of their own action |
| `soc-admin-security.test.ts` | 21 | Idle timeout; concurrent-session cap; new-device signal; step-up tokens (bound to the person, purpose and expiry); MFA coverage and enforcement for privileged roles; masked session addresses; the hooks in `requireAdmin`, sign-in and the MFA decision |
| `soc-recovery.test.ts` | 23 | Backup health is claimed only on evidence; no storage location ever leaves the module; restore-drill rules (isolated environment, checklist, performer ≠ reviewer, proof only when approved by someone else); recovery plan validation (secrets refused), versioning, approval by someone else; configured vs measured objectives |
| `soc-overview.test.ts` | 9 | The readiness verdict (what makes each state); the overview reports zeros and "none yet" on an empty system; retention keeps incident evidence |
| `soc-security.test.ts` | 49 | Structure and privilege tests across the repository (below) |

## Coverage of the spec's required security tests (§17)

| Required test | How it is covered |
|---|---|
| Unauthorized administrator access | Every `/api/admin/soc/**` route authorises with a named `soc:*` permission (never bare), checks the feature switch, rate-limits by administrator, records access; the existing route-authorization coverage test still passes for the whole API |
| Role escalation | No staff, viewer, analyst or domain-manager role holds any `soc:*` permission; only SUPER_ADMIN can approve containment, change rule strength or configuration; role-management still refuses self-grant; the service refuses self-approval even for a Super Admin |
| Insecure direct object references | SOC records are not owned by individuals; they are gated by permission and unknown ids answer 404; applicant-owned routes keep their existing session-bound tests |
| Cross-user data leakage | SOC code reads no applicant contact or identity fields; events keep hashed identifiers; alert/incident evidence is pointers only |
| Session revocation | Idle timeout and cap tests; containment revokes sessions; `requireAdmin` checks revocation before every request (structure test) |
| MFA enforcement | Coverage and enforcement tests; enforcement is a setting, off by default |
| API rate-limit bypass | Limits are keyed by the signed-in administrator in addition to address; the persistent counter is shared across server instances |
| Webhook spoofing | Every inbound webhook route verifies a signature before processing; the shared handlers are asserted; existing behavioural suites for forged signatures remain |
| Webhook replay | Idempotency keys and a staleness limit are asserted; existing replay suites remain; stale/duplicate deliveries are recorded as events |
| Secret leakage | The DR plan refuses secret-looking text; audit scrubbing removes passwords, tokens and keys; docs contain no credential-looking text; no API response carries a storage location; the static scan passes |
| Unauthorized exports | Every administrator export route needs a named permission and leaves an audit entry (itself or through its service); exports are mirrored into the bulk-export detection |
| Private document access | Every publicly addressable stored object is ciphertext (an explicit check per storage module); the existing document access suites remain |
| Backup access restrictions | The only code that reads a backup location reduces it to yes/no; the only caller allowed to delete a backup is the retention policy; the backup store is only handed encrypted bytes |
| Restore integrity | The existing backup suite plus the restore-drill rules; the restore script's safety rails (no default to the live database, typed confirmation to overwrite) are asserted |
| Audit-log tampering | Nothing updates an audit row; only the retention sweep deletes them; SOC history tables are append-only |
| Prompt injection | Detector tests (seven patterns and benign controls); the pipeline records a pattern code only and never changes an outcome because of it |
| Unauthorized AI actions | No module under `src/lib/ai` imports anything that approves, grants, deletes, refunds, restores, contains or sends, and none writes the people, permission, consent or money tables; the copilot refuses write actions |

## Findings

**Found and fixed during this step**

1. *Medium* — Failed signature checks on the **verification-provider webhook** were audited but never counted as security events, so a spoofing campaign against that one endpoint would not have triggered detection. Fixed; the coverage test now fails if any inbound webhook lacks the report.
2. *Medium* — The shared **audit scrubber** hid `password` and `token` keys but not `apiKey` (camelCase) or `passwd`/`bearer`/`credential`. Fixed (`src/lib/marketing/audit.ts`); a behavioural test covers it.
3. *Low* — The new-device rule for administrators would never have fired, because only applicant sessions published that event. Fixed (published at administrator sign-in).
4. *Low* — A rate-limit flood could have become a database write flood through the new event. Designed out: one event per window, on the first refusal.

**Open — disclosed, not fixed here**

| Severity | Finding | Why it remains |
|---|---|---|
| Medium | Backups, photos, documents, evidence and exports are encrypted before upload, but the object store gives each one a **public, unguessable address**. No API returns the address and the content cannot be read without the server-held key. | The storage service used here offers public objects; moving to private storage is a platform change. Shown as a warning in the readiness verdict. |
| Medium | **Content-Security-Policy is report-only.** | Switching to enforce can break pages if a violation has not been reviewed; it is an owner decision (`CSP_MODE=enforce`). |
| Low | An in-memory `rateLimit()` helper (per server instance) is still used by a few public routes and its refusals are not security events. | It predates the persistent limiter; replacing it is a separate refactor. |
| Low | Prompt-injection detection is pattern-based. | It is advisory by design; the protections that matter are permissions, consent, the read-only copilot and the output safety filter. |
| Info | Detection runs once a day and on demand, not in real time. | One scheduled job per day on the current hosting plan. |

No critical or high-severity finding was open at the end of the run.

## Not tested — stated plainly

- **No live penetration test and no load test** were performed.
- **The new screens have not been exercised in a browser against a real database.** The tests exercise the services over an in-memory database and check the routes and pages structurally; the migrations create the tables only when the deployment platform applies them. The first live check happens after a deploy, with the switches still off, then one at a time.
- **An isolated restore has not been performed**, because it needs a scratch database that only the owner can create. Until a drill is completed and approved, "restore proven" stays *No* in the product.
- The in-memory database used by the flow tests is a stand-in, not PostgreSQL; query semantics that differ (collation, JSON operators, large-result behaviour) are not covered.

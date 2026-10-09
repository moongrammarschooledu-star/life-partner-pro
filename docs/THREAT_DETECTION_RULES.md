# Threat detection rules

> The rule table below is generated from `src/lib/soc/rules/registry.ts` (`npx tsx scripts/render-soc-docs.ts`) and checked by a test, so it cannot drift from the code.

## How detection works

A **rule** counts one kind of recorded event inside a time window and raises a security alert when a threshold is reached. A rule's *definition* — what it reads and what it means — is fixed in code. Its *tunable values* — threshold, window, severity, on/off — are **versioned database rows**, so every change has an author, a reason and a history, and a version can never change what a rule is about.

- **Reads only closed shapes.** A rule can ask for security events, denied AI requests, or failed backups. It cannot run arbitrary queries. Reads select identifiers and timestamps only, never request bodies, and read at most 20,000 rows per rule per run; if that cap is hit the run says so, because the count may then be an under-count.
- **Rolling windows.** The daily job looks back to where the previous run ended (at least one window, at most 7 days) and finds the *busiest* rolling window inside that period. A burst at 03:10 is therefore still found when the job runs at 08:00.
- **Distinct counting** is used where the pattern is "many different accounts from one network" (credential stuffing) rather than "many attempts".
- **Neutral wording.** An alert says "Suspicious activity detected: …" or "Attention needed: …" and states what was counted. It never says a person is a fraudster, attacker or criminal, and detection never acts on a person — its only outputs are alerts.
- **No duplicates, no alarm fatigue.** An alert that is still open is not raised again (it is updated if there is newer evidence). After it is closed, the same finding is not raised again for the same evidence, nor within the *quiet period* set in the security configuration.

## Cadence — stated honestly

The platform runs on a plan with **one scheduled job per day**. Full evaluation runs in that daily job and when an authorised person presses **Run now**. A handful of high-signal facts (a webhook that failed signature checks, a privilege change, break-glass use, a backup failure) are also *recorded* the moment they happen, but they are still *evaluated* by the next run. This is detection with a daily cadence, not real-time monitoring, and the screens say "last run at …" rather than "live".

## Versions and review

| Change | What happens |
|---|---|
| Stricter (lower threshold, longer window, higher severity, switched on) | Takes effect immediately as a new version. |
| Quieter (higher threshold, shorter window, lower severity, switched off) on a rule that is **protected** or currently **HIGH or above** | Saved as *proposed*. The active version is unchanged until a **different** administrator approves it. |
| Quieter on a low-severity, unprotected rule | Takes effect immediately as a new version. |

Every change needs a written reason and a password re-confirmation, and is audited. A change cannot be approved or rejected by the person who proposed it.

## Testing a change (dry run)

**Detection rules → Test / edit → Test against the last 7 days** evaluates a candidate threshold/window/severity over the past 7–30 days and shows how many alerts it *would* have raised. It reads only, creates no alert and changes no rule. Use it before making a rule quieter or noisier.

## The rules

<!-- BEGIN GENERATED:rules -->
| Rule | What it counts | Reads | Starting threshold | Window | Severity | Protected |
|---|---|---|---|---|---|---|
| `auth.failed_logins` — Repeated failed sign-ins | Many failed sign-ins against the same account within a short window. (failed sign-ins) | SecurityEvent | 8 | 30 min | MEDIUM | no |
| `auth.credential_stuffing` — Many accounts tried from one network | Failed sign-ins against many different accounts from the same network address (a pattern consistent with credential stuffing). (distinct accounts) | SecurityEvent | 6 | 60 min | HIGH | yes |
| `auth.otp_failures` — Repeated one-time-code failures | Repeated wrong one-time codes for the same account. (failed codes) | SecurityEvent | 5 | 30 min | MEDIUM | no |
| `admin.sensitive_access_burst` — Burst of sensitive admin access | An administrator opened an unusually large number of sensitive records in a short window. (sensitive accesses) | SecurityEvent | 40 | 60 min | MEDIUM | no |
| `admin.new_device_logins` — Sign-ins from several new devices | An administrator account signed in from several new devices in a day. (new-device sign-ins) | SecurityEvent | 3 | 1440 min | LOW | no |
| `admin.privilege_changes` — Unusual number of privilege changes | Roles or permissions were changed unusually often by the same administrator. (privilege changes) | SecurityEvent | 3 | 60 min | MEDIUM | yes |
| `admin.break_glass_use` — Break-glass access used | Emergency (break-glass) access was used. Every use is reviewed. (break-glass uses) | SecurityEvent | 1 | 60 min | HIGH | yes |
| `admin.session_anomalies` — Admin session anomalies | Sessions were refused or ended by the session policy repeatedly for the same administrator. (session anomalies) | SecurityEvent | 3 | 60 min | MEDIUM | no |
| `security.config_changes` — Unusual number of security configuration changes | Security configuration was changed unusually often by the same administrator. (configuration changes) | SecurityEvent | 3 | 60 min | MEDIUM | yes |
| `data.bulk_exports` — Bulk exports | An administrator produced several data exports in a short window. (exports) | SecurityEvent | 5 | 60 min | HIGH | yes |
| `data.excessive_searches` — Excessive profile searches | An administrator ran an unusually large number of profile searches. (searches) | SecurityEvent | 150 | 60 min | MEDIUM | no |
| `data.sensitive_record_burst` — Burst of contact or document access | An administrator opened many contact details or documents in a short window. (record accesses) | SecurityEvent | 40 | 60 min | MEDIUM | no |
| `doc.unauthorized_access` — Repeated unauthorised document requests | Documents were requested without permission several times. (refused document requests) | SecurityEvent | 3 | 60 min | HIGH | no |
| `doc.tamper_detected` — Document integrity mismatch | A stored document no longer matches its recorded hash. (integrity mismatches) | SecurityEvent | 1 | 1440 min | CRITICAL | yes |
| `api.permission_denied_burst` — Repeated permission refusals | An administrator account was refused for lack of permission many times. (refusals) | SecurityEvent | 15 | 30 min | MEDIUM | no |
| `api.auth_failure_burst` — Repeated unauthenticated API requests | Many requests from one network were refused for failed authentication. (refused requests) | SecurityEvent | 20 | 30 min | MEDIUM | no |
| `api.rate_limit_abuse` — Rate limits hit repeatedly | The same network hit a rate limit in several separate windows. (rate-limit windows exceeded) | SecurityEvent | 3 | 60 min | MEDIUM | no |
| `webhook.signature_failures` — Webhook signature failures | An inbound webhook endpoint received several deliveries that failed signature verification. (failed deliveries) | SecurityEvent | 5 | 30 min | HIGH | yes |
| `webhook.replays` — Webhook replays | Stale (replayed) webhook deliveries were received for the same endpoint. (replayed deliveries) | SecurityEvent | 3 | 60 min | MEDIUM | no |
| `webhook.duplicate_flood` — Webhook duplicate flood | An unusually large number of duplicate webhook deliveries for the same endpoint (provider retries are normal in small numbers). (duplicate deliveries) | SecurityEvent | 100 | 60 min | LOW | no |
| `ai.prompt_injection` — Prompt-injection patterns | An administrator's AI input matched prompt-injection patterns several times (pattern codes only are recorded). (flagged inputs) | SecurityEvent | 3 | 60 min | MEDIUM | no |
| `ai.unauthorized_action` — AI asked to take a restricted action | An administrator repeatedly asked the AI for an action it is never allowed to take. (restricted-action requests) | SecurityEvent | 2 | 60 min | HIGH | no |
| `ai.denied_burst` — Repeated AI access denials | An administrator's AI requests were denied many times. (denied AI requests) | AiRequest | 10 | 60 min | MEDIUM | no |
| `backup.failed` — Backup failed | A backup run ended in failure. (failed backups) | BackupRun | 1 | 1440 min | CRITICAL | yes |
| `backup.deletion_attempts` — Backup deletion attempted | Something tried to delete a backup outside the retention policy (blocked). (blocked deletions) | SecurityEvent | 1 | 1440 min | CRITICAL | yes |
<!-- END GENERATED:rules -->

Thresholds are **starting points chosen to be quiet on a small team**, not recommendations from measured traffic. Tune them with the dry run once the platform has real traffic.

## Event sources

| Source table | Fed by |
|---|---|
| `SecurityEvent` | The event pipeline: sign-in failures, one-time-code failures, permission refusals, unauthenticated API requests, document access refusals, new-device sign-ins (administrators), plus the SOC additions below |
| `SecurityEvent` (SOC additions) | Webhook signature failures and stale/duplicate deliveries (all six inbound webhook families), rate-limit refusals (first refusal per window), exports, privilege changes, break-glass use, sensitive record access and profile searches (mirrored once from the audit writer), session anomalies, backup failures and blocked backup deletions, AI prompt-injection patterns and restricted-action requests |
| `AdminLoginHistory` | Counted on the overview (sign-in attempts and lockouts) |
| `AiRequest` | Denied AI requests |
| `BackupRun` | Failed backups |

What an event stores: its type, the acting administrator or a **salted hash** of the account/network (never the raw address or e-mail), an outcome and a size-capped, redacted note. It never stores passwords, access tokens, card data, request bodies, prompt text or file names.

## What a rule cannot do

- It cannot block, restrict, suspend or accuse anyone. Containment (see the incident response plan) is a separate, human, time-limited action.
- It cannot see data it is not given: it has no access to profile content, messages or documents.

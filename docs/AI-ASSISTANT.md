# AI Matchmaking Assistant (STEP 16)

**AI recommends and explains. Humans decide.** The deterministic matching engine (`src/lib/matching.ts`, `LPP-MATCH-v1.x`) remains the only source of compatibility scores and ranking.

## What it is
- **Built-in analysis provider** (default): rule/template driven, runs in-process, no network call, no data leaves the system, no per-request cost.
- **Claude adapter** (optional, OFF): used only if all of these hold — `ANTHROPIC_API_KEY` is set in the environment, an admin selects provider *Claude* **and** allows external access (needs a passing AI test run), **and** the member has given *explicit* AI consent (a grant made in the Consent Center; the implicit historical backfill does **not** count). Otherwise the built-in provider is used and the admin is told why.
- It is **admin-only**. Nothing AI-related is shown to members.

## Safety boundaries (enforced in code)
- Read / analyse / draft only. No tool exists that sends, approves, rejects, verifies, shares contact details, deletes, suspends, refunds or finalises.
- Every request runs one pipeline (`src/lib/ai/pipeline.ts`): availability (kill switch, rollout phase, feature flags, permission) → rate limit + quota → authorised data loading (STAFF row scoping, sensitive-field permissions, restrictions) → consent → provider → schema validation → **safety filter** → audit → storage policy.
- A field the requesting admin cannot see is **never loaded**, so it cannot reach a prompt or provider. Unknown and inaccessible profiles look identical (no existence oracle).
- External payloads are pseudonymous (`Profile A/B`) and contain no name, contact, area, income, occupations, identifiers or free text.
- Prompt-injection defence: user-authored text is detected/neutralised and wrapped as untrusted data; model output can never trigger a tool.
- Output safety filter blocks contact leakage, appearance/ethnicity/health/personality inferences, stereotyping, and rewrites guarantees, success probabilities, accusations, coercion and legal conclusions to neutral wording. It is a rule-based guard rail, **not proof of safety**.

## Operating it
1. Deploy. The migration is additive; AI starts **DISABLED**. Nothing changes for users.
2. Super Admin signs in again (permissions are frozen at login) → **Admin → AI Assistant → AI Settings** → *Run tests*.
3. Approve prompts (needs the passing run), then move the phase: `DISABLED → INTERNAL_TEST → STAFF_PILOT → LIMITED_PRODUCTION → PRODUCTION`, one step at a time (reason + password re-confirmation). Also switch on the `ai.*` feature flags in System Configuration.
4. **Kill switch** (AI Settings): stops all AI instantly; deactivating needs re-confirmation. Deterministic matching is unaffected.
5. Monitoring: AI Health, AI Usage & Cost (cost is only an *estimate* and only when the provider reports tokens and a price is set), AI History (metadata only), alerts `AI_FAILURE_RATE`, `AI_UNSAFE_OUTPUT`, `AI_UNAUTHORIZED_ACCESS`, `AI_COST_SPIKE`, runbooks `ai-provider-outage`, `ai-privacy-incident`, `ai-kill-switch`.

## Data handling
- Default result storage is **summary only** (no evidence lines/lists); results expire after `retentionDays`; HIGHLY_SENSITIVE lines (e.g. income) are never stored. Expired results are purged by the daily retention sweep and AI data for a member is erased with account deletion/anonymisation. AI request metadata is kept for an operational 180 days — an operational default, **not** a legal retention period.
- Audit events: `AI_*` in the audit log with actor, feature, provider/model, prompt version, status, correlation id. Prompt and result text are never audited.

## Known limitations
- The external adapter is contract-tested with mocks only until a real key is configured and exercised.
- Copilot is an intent router over permission-bound read tools, not a free-form LLM agent.
- Fairness checks are rule/probe based, not a statistical audit. Document analysis (§50) is not implemented.
- Members can grant/revoke the two new AI consent categories in the Consent Center, but no member-facing AI feature exists.

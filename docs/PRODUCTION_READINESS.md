# Production readiness checklist — STEP 33

A box is ticked only when the item was actually run or inspected for this step. An unticked box says why.

**Status of this branch's code: READY_WITH_WARNINGS. Status of the live site today: NOT_READY until this branch is deployed
(`PRODUCTION_BLOCKERS.md`).** PRODUCTION_READY is not claimed.

## Application
- [x] Build: the production build runs on Vercel on every deploy (main at 35371fe is live and healthy). A local `next build` of this branch was not run; the deploy build will be the proof.
- [x] Type check passes (`tsc --noEmit`)
- [x] Lint passes (0 errors, 64 warnings)
- [x] Unit tests pass (full run: see the audit report; the one failure on the first run was a timing limit under parallel load and passes alone)
- [x] Integration-style tests pass (service and route tests over in-memory databases)
- [ ] End-to-end tests: **not implemented** (no browser suite exists; the lifecycle is covered by state-machine and service tests)

## Security
- [x] Authentication tested (new sign-in tests; existing admin, family and OTP tests)
- [x] RBAC tested (permission matrix tests, per-handler route audit, profile route assignment test)
- [ ] RLS tested: **not applicable**, no row-level security is used
- [x] API security: per-handler audit, input limits on public routes, no unsafe raw SQL, no raw error text in responses
- [x] IDOR: ownership heuristics in the audit (1 informational hit, a public guide page); assignment gate for profile sub-routes
- [x] Rate limits registered and tested (existing registry test; new limits added)
- [x] Webhooks: signature, timestamp and replay covered by the STEP 32 tests; **no live replay against a real provider**
- [x] Secrets audited (static scan pass, no secret in the repository); the Neon password rotation is pending

## Privacy
- [x] Sensitive data protected (field-level serialisers; search oracle closed this step)
- [x] Consent verified (contact permission now needs mutual interest and an open proposal)
- [x] Contact privacy verified (no automatic disclosure; share needs consent, approval and audit)
- [x] Document privacy verified (encrypted at rest, served through authorised routes)
- [ ] Export controls: covered by earlier steps' tests; not re-audited line by line here
- [ ] Deletion workflow: covered by earlier steps' tests; not exercised end to end here

## Payments
- [x] Payment verification tested (entitlement only from signed webhook or administrator verification)
- [x] Webhook verification tested (earlier steps)
- [x] Entitlements tested (earlier steps)
- [x] Refund authorisation tested, including the new simultaneous-execution cases
- [x] Manual payment verification tested for simultaneous requests
- [ ] Coupon usage limit under concurrency: a small over-redemption window remains (low)

## Operations
- [x] Tasks, approvals, CRM, communications and notifications covered by their existing suites (all green)
- [ ] Browser walkthrough of each module: not run

## Recovery
- [x] Backup successful (daily, encrypted, verified on creation; newest verified backup this step)
- [x] Backup verified (decrypt, checksum, schema, integrity comparison)
- [ ] Restore tested: **partly** (database, migrations, relationships, start-up and administrator sign-in on 11 Oct 2026; files and critical workflows not yet)
- [ ] DR plan tested: no tabletop test recorded
- [ ] Business continuity tested: documented, not exercised

## Deployment
- [x] Production environment configured (flags, labels, CSP enforcing, MFA for privileged roles)
- [x] Environment variables verified by name; `.env.example` holds names only
- [x] SSL and domain: served over HTTPS on the Vercel domain; a custom domain is not configured
- [x] Health checks: `/api/health`, `/api/health/live`, `/api/health/ready` exist and return status only
- [x] Monitoring enabled: SOC detection and escalation are on
- [x] Rollback procedure documented (audit report, section 15)
- [ ] Post-deployment smoke test of this branch: **to be done after deploy** (the sign-in code e-mail, an administrator sign-in, the health endpoint)

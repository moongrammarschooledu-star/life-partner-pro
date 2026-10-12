# Runbook: payment outage or payment misbehaviour

**Payments are OFF at launch** and stay off until the owner turns them on through the controlled rollout (Admin > Finance Center > Rollout). If payments were never enabled, none of this applies - confirm that first.

## Symptoms
- Payment failures spike, a webhook is failing or arriving late, a payment shows paid at the provider but not here (or the reverse), a wrong amount, duplicate charges, refund problems, the provider is down.

## Diagnosis
1. Is it on? Admin > Finance Center > Rollout: payments master switch, environment (sandbox vs production), provider.
2. Admin > Finance Center > Webhooks: failed or unprocessed events, last received time, signature failures.
3. Provider dashboard: the same payment, its status, any incident notice.
4. Compare: our payment record versus the provider's, one at a time. Do not bulk-edit.

## Immediate actions
1. **Stop new payments**: Admin > System Configuration > Emergency > *payments* (the payment kill switch; requires your password and a written reason). Existing records are untouched; applicants see a neutral message.
2. Do **not** delete or hand-edit payment records. Manual corrections go through the finance screens (manual payment confirmation and refund both use a compare-and-set so two people cannot both succeed).
3. If webhooks failed: fix the cause (secret mismatch, outage), then use the provider's "resend event" - event handling is idempotent, so a resend does not double-apply.
4. If money moved wrongly: stop, record it, contact the provider; refunds are issued from the provider and recorded here.

## Verification
- Webhook queue empty, no new signature failures.
- A sandbox payment completes end to end before production is re-opened (use test mode only; never test with real cards).
- Reconciliation: counts and totals for the affected period match the provider's report.

## Escalation
Owner at once for any amount discrepancy. Payments with real money also need a second person to review before the switch is released.

## Recovery
Re-open the switch only after the cause is fixed and one sandbox payment passes. Re-check the rollout stage.

## Rollback
If a release caused it: [rollback.md](rollback.md), with the payment switch still on until verified.

## Post-incident
List affected payments and their resolution; add a test or a reconciliation check for the failure; review webhook alerting.

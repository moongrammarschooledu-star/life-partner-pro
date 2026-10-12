# Runbook: WhatsApp outage or block

WhatsApp is **off at launch** (`whatsapp.enabled` and `WHATSAPP_ENABLED`) and only sends template messages to people who gave consent. If it was never enabled, nothing is lost: e-mail and in-app notices carry every message.

## Symptoms
- WhatsApp provider health DEGRADED/DOWN; messages stuck QUEUED or FAILED; template rejected; quality rating dropped; account restricted or banned; webhook signature failures.

## Diagnosis
1. Admin > Communications > provider health and the delivery log for WhatsApp (status, error code, no message bodies).
2. Meta Business Manager / WhatsApp Manager: account status, quality rating, template approval state, messaging limit.
3. Check credentials: an expired access token is the most common cause (`WHATSAPP_ACCESS_TOKEN` in Vercel). Webhook failures: `WHATSAPP_APP_SECRET` / `WHATSAPP_VERIFY_TOKEN` mismatch.

## Immediate actions
1. Switch the channel off if it is failing noisily or the account is at risk: flag `whatsapp.enabled` (Admin > System Configuration). Messages are held, not deleted; the circuit breaker already pauses a failing provider for 5 minutes at a time.
2. A blocked or low-quality account: **stop sending**, do not create a second account to get around it (that breaches WhatsApp policy and makes it worse). Reduce volume; fix templates and consent.
3. Move important messages to e-mail or in-app notice. Staff may contact an applicant by their preferred channel from their own account when the message is urgent.

## Verification
- A single test message to an internal recipient allow-listed in `COMMUNICATION_TEST_RECIPIENTS` is delivered (staging first).
- Webhook status callbacks arrive and update the log.
- Provider health HEALTHY.

## Escalation
Owner. Meta business support for account-level actions.

## Recovery
Re-enable the flag; watch the first sends and the quality rating for a day. Opt-outs ("stop") are honoured automatically and never overridden.

## Rollback
Only if a release changed templates/sending - [rollback.md](rollback.md).

## Post-incident
Which messages were delayed, whether consent rules held, template changes needed.

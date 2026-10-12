# Runbook: security incident

Suspected breach, account takeover, data exposure, abuse of contact sharing, or a leaked secret. The in-app incident workflow (Admin > Security Operations > Incidents) is the record; this page is the order of work. See also `docs/INCIDENT_RESPONSE_PLAN.md`.

## Symptoms
- A security alert (Admin > Security Operations > Alerts), an administrator reporting an unfamiliar login, an applicant reporting contact details were shared without consent, a secret appearing somewhere it should not, unusual exports or searches, a spike of failed sign-ins.

## Diagnosis
1. Open the alert or create an incident (severity, category, owner). Write down the first time you noticed it.
2. Admin > Security Operations > Admin security: sign-in history, active sessions, who lacks two-step sign-in.
3. Admin > Audit Log around the suspected time: exports, role changes, contact reveals, break-glass access.
4. Decide what is at stake: administrator account, applicant data, payments, a secret key.

## Immediate actions (contain, in this order)
1. **Revoke the account's sessions**: Admin > Admin security > the administrator > revoke sessions; deactivate the account if it is compromised. Changing a password does not end an attacker's existing session - revoking does.
2. **Stop the leak path** with the narrowest switch: Emergency > *contact sharing*, *uploads*, *registrations* or *notifications*. Nothing is deleted.
3. **Rotate the secret** if one leaked (Vercel > Settings > Environment Variables, then redeploy):
   - `NEXTAUTH_SECRET` signs sessions **and** derives file keys - rotating it signs everyone out and old encrypted files stop opening. Prefer rotating only the others unless it is the leaked one.
   - Database password: Neon console > reset the role password, update `DATABASE_URL` in every Vercel environment, redeploy production.
   - Provider tokens (SMTP, WhatsApp, Twilio, payment): rotate at the provider, then update Vercel.
   - `BACKUP_ENCRYPTION_KEY`: older backups need the old key - keep it safely offline before replacing.
4. If an administrator is locked out of recovery: the owner can use `node scripts/admin-recovery.mjs` from their own machine (never share the output).
5. Preserve evidence: do not delete audit rows, security events or backups. Retention is automatic and nothing in the app deletes them on request.

## Verification
- The attacker's sessions are gone (Admin security shows none you do not recognise).
- No new alerts of the same kind for an hour.
- `node scripts/security-smoke.mjs --url https://<site>` passes.

## Escalation
Owner at once. If applicant personal data may have been exposed, the owner decides about notifying the affected people and any regulator under the applicable law (this system records the facts; it does not make the legal decision).

## Recovery
Restore switches one at a time, watching alerts. Re-enable accounts only after the cause is closed. Confirm every administrator has two-step sign-in.

## Rollback
If a fix made things worse, roll back the release ([rollback.md](rollback.md)); security switches stay as they are until the incident closes.

## Post-incident
Close the incident with root cause and lessons learned (the app will not close it without them). Add a detection rule or a test for the gap. Review who held which permissions.

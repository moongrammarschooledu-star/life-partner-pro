# Runbook: e-mail not arriving

E-mail carries applicant sign-in codes, administrator sign-in and reset codes, invitations and notifications. Today it is sent through SMTP (a Gmail account with an app password) until a verified sending domain exists.

## Symptoms
- Applicants or administrators say the code never came; Admin > Communications shows e-mail provider DEGRADED/DOWN or many FAILED/QUEUED; bounces; messages landing in spam.

## Diagnosis
1. Admin > Communications > provider health (e-mail) and the delivery log: status and error class per message (no message bodies, no addresses in alerts).
2. Is it the provider? SMTP login errors mean the password/app password was revoked or the account hit its daily limit (Gmail allows only a few hundred messages per day - far below a real launch volume).
3. Is it spam placement? Without SPF, DKIM and DMARC on a domain you control, mail from a free mailbox is often filtered. Check the headers of a delivered test message for `spf=`, `dkim=`, `dmarc=` results.
4. Is the flag off? `email.enabled` off means messages are *held*, not sent.

## Immediate actions
1. If administrators cannot sign in because codes do not arrive: the owner runs `node scripts/admin-recovery.mjs list` / `reset <email>` / `set-email` on their own machine (it asks for the new password in the terminal; nothing is printed or logged).
2. Applicants who cannot receive a sign-in code: use the staff-assisted path (Admin > profile > contact the applicant by phone) and do **not** switch off `auth.applicant_otp_login.enabled` unless e-mail will be down for long - turning it off returns to the weaker Profile-ID-plus-e-mail sign-in. If you must, turn it back on the moment e-mail works.
3. Fix the credential: create a new app password / rotate the SMTP credential at the provider, update `SMTP_USER`, `SMTP_PASS` (and `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM` if changed) in Vercel, redeploy.
4. Held messages: re-enable `email.enabled`; the queue drains by itself, expired messages stay expired.

## Verification
- Request an applicant sign-in code for a test profile that uses your own address; it arrives in the inbox (not spam).
- Request an administrator sign-in code and an applicant sign-in code; both arrive within a minute.
- Provider health HEALTHY; queue empty.

## Escalation
Owner. If the sender account is suspended, the recovery is a different provider - set up a transactional e-mail provider with a verified domain (see `GO_LIVE_CHECKLIST.md`).

## Recovery
Move to a verified sending domain with SPF, DKIM and DMARC published; keep `EMAIL_FROM` on that domain.

## Rollback
Only if a release changed e-mail sending: [rollback.md](rollback.md).

## Post-incident
How many people were affected, whether any locked out; make sure a second administrator exists and that the recovery script is tested.

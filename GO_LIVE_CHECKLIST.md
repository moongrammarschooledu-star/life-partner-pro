# Go-live checklist

Work through this top to bottom. **"Auto"** items are verified by the system (Admin > Production Readiness and Admin > Deployment & Go-Live); **"You"** items need an account or a decision only the owner can make. The go-live approval gate will not move to READY while required automatic gates fail, and needs a second administrator to approve.

Legend: [x] verified on 2026-10-12, [ ] open, [-] not applicable yet.

## A. Application and release
- [x] Auto - CI green on `main` (types, lint, tests, security scan, dependency audit, migration validation, build)
- [x] Auto - Production deployment Ready; Deploy gate (health, smoke, security smoke) passes
- [ ] Auto - STEP 34 merged and deployed; release shows HEALTHY on Admin > Deployment & Go-Live
- [ ] You - Branch protection on `main` (pull request + `CI / verify` required) and a `production` Environment with reviewers (GitHub > Settings)
- [ ] You - Decide the launch version: change `1.0.0-rc.1` to `1.0.0` when the gate reaches LIVE

## B. Domain, HTTPS, e-mail identity
- [x] Auto - HTTPS only, `http://` redirects (308), HSTS 1 year, certificate valid (renews itself)
- [ ] You - Custom domain attached in Vercel, DNS records created, `APP_URL` set to it, redeploy
- [ ] You - Verified sending domain with SPF, DKIM, DMARC; `EMAIL_FROM` on that domain; SMTP or provider credentials updated
- [ ] You - Send a real e-mail to a different mailbox provider and confirm it arrives in the inbox (invitation link opens the canonical address)

## C. Database and data
- [x] Auto - Migrations applied and in sync; additive only
- [x] Auto - No demo data path to production (seed guard); production database not seeded with fake records
- [ ] You - First administrator is a real person with a strong unique password and two-step sign-in; **a second Super Admin exists** (needed for approvals)
- [ ] You - Rotate the Neon database password (it was shared in a chat); update `DATABASE_URL` in every Vercel environment; redeploy; re-set the Preview value
- [ ] You - Decide on a Neon plan with longer point-in-time history, or enable the `pg_dump` workflow (`BACKUP_WORKFLOW_ENABLED=true`)

## D. Backups and recovery
- [x] Auto - Encrypted daily backup with automatic restore verification
- [ ] You - `BACKUP_ENCRYPTION_KEY` stored in the password manager **and** offline; delete `.env.backup-key` from the laptop afterwards
- [ ] You - Complete a restore drill with real data (file restore + critical workflows) and have a second administrator review it (Admin > Security Operations > Restore drills)
- [ ] You - Fill in the disaster-recovery plan in the app (contacts, providers) and have it approved by a different administrator

## E. Security
- [x] Auto - Route-authorization audit, security scan, dependency audit pass
- [x] Auto - CSP enforcing; security headers present
- [ ] You - Every administrator uses two-step sign-in (Admin > Security Operations > Admin security shows none missing)
- [ ] You - Review remaining dependency advisories (`npm run deps:audit`); `next` upgrade decision with the owner
- [ ] You - Set `CRON_SECRET` and `NOTIFICATION_WEBHOOK_SECRET` if not set (Production Readiness shows BLOCKER otherwise)

## F. Monitoring and alerting
- [x] Auto - Health endpoints answer ready (observed 2026-10-12); in-app errors, alerts and SOC detection exist (confirm the monitoring self-test gate on Production Readiness)
- [x] Auto - GitHub uptime probe every 15 minutes is active (`.github/workflows/uptime.yml`); confirm the first scheduled run in GitHub > Actions and that the `EVIDENCE_URL` secret is set
- [ ] You - Create a free external uptime monitor (e.g. UptimeRobot) for `/api/health/live` with e-mail/SMS alerts to the owner
- [ ] You - Optional error tracker (Sentry) - not configured; in-app error capture is the current mechanism
- [ ] You - `ALERT_WEBHOOK_URL` (Slack-compatible) if you want alerts outside the app

## G. Integrations - keep OFF until verified
- [x] Payments are OFF (master switch). Do not enable until sandbox end-to-end passes. While they are off, the payment readiness gates (provider, sandbox checklist, refund, kill switch, reconciliation) show as warnings and do not block go-live; the moment payments are switched on they block again until proven
- [ ] You - Payment provider: sandbox keys first, webhook secret, one sandbox payment + refund, then production keys, then the rollout (Admin > Finance Center > Rollout), with a second person watching
- [ ] You - WhatsApp (Meta): business verification, approved templates, token and secrets in Vercel; test with `COMMUNICATION_TEST_RECIPIENTS` in staging first; then the `whatsapp.enabled` flag
- [ ] You - SMS (Twilio): credentials, sender, test; then `sms.enabled`
- [ ] You - Marketing, engagement, analytics, AI flags: all default OFF - enable one at a time after review

## H. Kill switches (rehearse once before launch)
- [ ] You - Turn one switch on and off and see the audit entry: registrations, matching, proposals, contact sharing, payments, uploads, notifications (Admin > System Configuration > Emergency); flags `whatsapp.enabled`, `sms.enabled`, `email.enabled`, `ai.enabled`, `marketing.enabled`

## I. Final gate (Admin > Deployment & Go-Live)
1. Readiness shows READY (all required gates).
2. Administrator A: **Mark ready** (password + note).
3. Administrator B (different person): **Approve go-live**.
4. Either: **Record as live** after the launch announcement.
5. Watch Admin > System Health and Alerts closely for the first 48 hours (see monitoring period in the release record).

If anything fails: **Block** (reason required) - nothing is deleted - and use the runbooks in `docs/runbooks/`.

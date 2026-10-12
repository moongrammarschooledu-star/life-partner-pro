# Runbook: DNS / domain recovery

At the time of writing the site runs on its Vercel address (`lifepartnerpro.vercel.app`). **No custom domain is configured yet.** This runbook applies from the day one is attached; until then the only "DNS" risk is Vercel's own.

## Symptoms
- The address does not resolve or shows the wrong site; browsers warn about the certificate; some people reach the site and others cannot; e-mails link to an address that no longer works; the uptime probe fails on HTTPS or certificate checks.

## Diagnosis
1. From your own machine: `nslookup <domain>` and `nslookup -type=NS <domain>`; try a phone on mobile data (different resolver).
2. `curl -sI https://<domain>/` - status, `strict-transport-security`, redirect target.
3. Certificate: `echo | openssl s_client -servername <domain> -connect <domain>:443 2>/dev/null | openssl x509 -noout -dates -subject`.
4. Vercel > the project > Settings > Domains: each domain's state (Valid / Invalid configuration). The registrar: is the domain expired, locked, or were name servers changed?
5. Recent DNS edits at the registrar/DNS host.

## Immediate actions
1. **Domain expired or suspended**: renew at the registrar (turn on auto-renew and lock afterwards).
2. **Records wrong or deleted**: restore them as shown by Vercel > Domains (an `A` record for the apex and a `CNAME` for `www`, or the Vercel name servers). Keep a screenshot/export of the correct records in the password manager.
3. **Certificate problem**: Vercel issues and renews certificates itself once the domain validates; fix the record Vercel marks invalid and wait a few minutes. Do not upload your own certificate.
4. **Fall back**: the `*.vercel.app` address keeps working independently of your domain. Send people there via an announcement and temporarily set `APP_URL` back to it (Vercel env, redeploy) so e-mailed links work.
5. Do not change e-mail records (MX, SPF, DKIM, DMARC) while recovering the web records - they are separate and an edit can break mail.

## Verification
- `nslookup` returns the Vercel targets from several networks; `curl -sI https://<domain>/` returns 200 with HSTS; `http://` redirects to `https://`.
- `node scripts/smoke.mjs --url https://<domain>`.
- A test e-mailed link (invitation) opens the right address (`APP_URL` is the single source for these links).

## Escalation
Owner (registrar account holder). Registrar support for lockouts; Vercel support for certificate issuance.

## Recovery
Propagation can take from minutes to a day - lower the TTL before planned changes. After recovery, verify HSTS and that `APP_URL` equals the canonical address.

## Rollback
Re-apply the previously working records from your saved copy.

## Post-incident
Cause, who holds registrar access (at least two people), auto-renew on, expiry date in a calendar.

# Environment variables

The complete list of variables the code reads. **Names only** - values are set in Vercel (Project > Settings > Environment Variables) per environment, never committed. `.env.example` carries the same names with empty placeholders. The severity column is what the application itself reports when the variable is missing in production (`src/lib/config/validate.ts`); anything marked CRITICAL stops the readiness check and the migration runner.

Keep three environments apart: **Development** (your laptop, its own database), **Preview** (staging, its own Neon branch, sandbox providers only), **Production**. Never copy a production value into another environment.

## 1. Identity and addresses
| Name | Secret | Purpose | If missing in production |
|---|---|---|---|
| `APP_ENV` | no | `development`/`staging`/`production` (otherwise derived from `VERCEL_ENV`) | derived |
| `APP_URL` | no | Canonical https address used in every emailed link (`publicUrl()`) | BLOCKER; links cannot be created |
| `NEXT_PUBLIC_APP_URL`, `APP_BASE_URL`, `NEXTAUTH_URL`, `VERCEL_PROJECT_PRODUCTION_URL` | no | Older fallbacks `publicUrl()` tries after `APP_URL` | - |
| `DATABASE_ENV_LABEL`, `STORAGE_ENV_LABEL`, `PAYMENT_ENVIRONMENT` | no | Must equal `APP_ENV`; proves a database/storage/payment account belongs to this environment | BLOCKER; mismatch is CRITICAL |
| `LEGAL_PAGES_REVIEWED` | no | `true` hides the "wording pending legal review" notice on the privacy policy and terms once counsel has approved them (takes effect on the next deploy) | the notice stays visible |
| `LEGAL_GOVERNING_LAW` | no | Your own governing-law / jurisdiction wording; adds a "Governing law" section to the terms. Never invented by the app | the section is not shown |
| `APP_VERSION` | no | Set automatically from `package.json` at build (do not set by hand) | - |
| `VERCEL_ENV`, `VERCEL_GIT_COMMIT_SHA`, `VERCEL_GIT_COMMIT_MESSAGE`, `VERCEL_GIT_COMMIT_AUTHOR_LOGIN`, `VERCEL_URL`, `NODE_ENV`, `NEXT_RUNTIME` | no | Provided by Vercel/Next | - |

## 2. Core secrets
| Name | Secret | Purpose | If missing |
|---|---|---|---|
| `DATABASE_URL` | **yes** | Neon pooled connection (migrations derive the direct host) | CRITICAL |
| `NEXTAUTH_SECRET` (or `AUTH_SECRET`) | **yes** | Signs sessions and derives file-encryption keys; 32+ characters; rotating signs everyone out | CRITICAL |
| `BLOB_READ_WRITE_TOKEN` | **yes** | Vercel Blob store for private files | BLOCKER |
| `CRON_SECRET` | **yes** | Authenticates the daily cron call | BLOCKER |
| `NOTIFICATION_WEBHOOK_SECRET` | **yes** | Signs the notification webhook | BLOCKER |
| `CI_EVIDENCE_TOKEN` | **yes** | GitHub Actions posts evidence to the app (also a GitHub secret) | BLOCKER |
| `SEED_ADMIN_PASSWORD` | **yes** | Local demo seed only; must never be the shipped default | CRITICAL if default |

## 3. Backups
| Name | Secret | Purpose |
|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | **yes** | Encrypts backups (32+ chars, independent of `NEXTAUTH_SECRET`); losing it makes backups unreadable - keep a copy offline |
| `BACKUP_BLOB_READ_WRITE_TOKEN` | **yes** | Separate store for backup copies (recommended) |
| `BACKUP_LOCAL_DIR` | no | Development only; refused in production |

## 4. Hashing and signing secrets (32+ random characters each, all different)
`RISK_HASH_SALT`, `COMMUNICATION_HASH_SALT`, `COMMUNICATION_ENCRYPTION_KEY`, `MARKETING_TOKEN_SECRET` - used to hash identifiers and sign tokens; all secret.

## 5. Inbound webhook secrets (secret)
`SIGNATURE_WEBHOOK_SECRET`, `DOCUMENT_WEBHOOK_SECRET`, `EMAIL_WEBHOOK_SECRET`, `IDENTITY_VERIFICATION_WEBHOOK_SECRET`, `COMMUNICATION_SANDBOX_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `META_LEADS_VERIFY_TOKEN`, `TWILIO_AUTH_TOKEN`. A webhook route refuses unsigned calls; with no secret it accepts nothing it cannot verify.

## 6. Outside providers (all optional; nothing is enabled by setting them alone)
| Group | Names |
|---|---|
| E-mail (SMTP) | `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `SMTP_PORT`, `EMAIL_FROM` |
| SMS (Twilio) | `SMS_PROVIDER_API_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_MESSAGING_SERVICE_SID`, `TWILIO_STATUS_CALLBACK_URL`, `TWILIO_WEBHOOK_URL` |
| WhatsApp (Meta) | `WHATSAPP_ENABLED`, `WHATSAPP_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_API_VERSION` |
| Payments (Stripe) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (`sk_test_` outside production, `sk_live_` only with `PAYMENT_ENVIRONMENT=production`) |
| Meta ads | `META_ADS_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_APP_SECRET`, `META_DATASET_ID`, `META_LEADS_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN`, `META_API_VERSION` |
| Identity verification | `IDENTITY_VERIFICATION_ENABLED`, `IDENTITY_VERIFICATION_PROVIDER` (`IDENTITY_VERIFICATION_MOCK_OUTCOME` is for tests only - never in production) |
| AI | `ANTHROPIC_API_KEY` (only used if an administrator selects Claude **and** allows external access **and** the member consented) |

## 7. Behaviour and tuning
| Name | Purpose |
|---|---|
| `LOG_LEVEL` | DEBUG/INFO/WARN/ERROR/CRITICAL |
| `SLOW_QUERY_THRESHOLD_MS` | Slow-query aggregation threshold |
| `CSP_MODE` | `enforce` (production currently enforcing) or report-only |
| `ALERT_WEBHOOK_URL` | Optional Slack-compatible alert webhook (https only; secret) |
| `COMMUNICATION_ALLOWED_URL_HOSTS` | Extra hostnames allowed inside outgoing message links |

## 8. Must NEVER be set in production
`ALLOW_DEMO_SEED`, `COMMUNICATION_DEBUG_OTP` (prints codes), `COMMUNICATION_TEST_RECIPIENTS` (restricts who may receive messages - use only in staging), `IDENTITY_VERIFICATION_MOCK_OUTCOME`, `BACKUP_LOCAL_DIR`.

## 9. GitHub (Actions) secrets and variables
| Name | Kind | Used by |
|---|---|---|
| `EVIDENCE_URL` | secret | CI evidence, deploy gate and the uptime probe (the public https address, no trailing slash) |
| `CI_EVIDENCE_TOKEN` | secret | CI and deploy gate (must equal the Vercel value) |
| `BACKUP_DATABASE_URL`, `BACKUP_PASSPHRASE` | secrets | optional `pg_dump` workflow |
| `BACKUP_WORKFLOW_ENABLED` | variable | turns the optional `pg_dump` workflow on |

## 10. Rules
1. A secret-looking name must not start with `NEXT_PUBLIC_` (the scan fails the build).
2. Adding a variable: add its name here and to `.env.example`, validate it in `src/lib/config/validate.ts` if production needs it.
3. Rotation: see `docs/runbooks/security-incident.md` (rotate at the provider, update Vercel, redeploy production, re-set Preview by hand).
4. Never paste a value into chat, a ticket or a document.

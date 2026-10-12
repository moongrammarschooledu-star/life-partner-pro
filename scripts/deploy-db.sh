#!/usr/bin/env bash
# STEP 34 §10 - controlled database deployment: backup -> validate -> migrate -> integrity -> (deploy) -> smoke.
#
# Normal releases do NOT need this: `vercel-build` already runs `scripts/migrate-deploy.mjs` and stops the build if a migration fails, so the
# previous version keeps serving. Use this script when you want to run the steps one at a time with a human in the loop (a risky migration,
# a first production migration, a recovery).
#
#   scripts/deploy-db.sh pre  --backup-ref "<what you took>"            # backup proof, validate, migrate, integrity
#   scripts/deploy-db.sh post --url https://your-site [--expect-commit <sha>]   # wait for the new version, then smoke test
#
# It never pushes code, never changes environment variables, never uses a data-loss option and never prints a connection string.
# "Deploy" in the middle is yours: merge the pull request (Vercel deploys main) and then run the `post` phase.
set -euo pipefail

phase="${1:-}"; shift || true
backup_ref=""; url="${BASE_URL:-}"; expect_commit=""; yes="no"
while [ $# -gt 0 ]; do
  case "$1" in
    --backup-ref) backup_ref="${2:-}"; shift 2 ;;
    --url) url="${2:-}"; shift 2 ;;
    --expect-commit) expect_commit="${2:-}"; shift 2 ;;
    --yes) yes="yes"; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

step() { printf '\n== %s ==\n' "$1"; }
fail() { printf 'STOP: %s\n' "$1" >&2; exit 1; }

case "$phase" in
  pre)
    step "0. Safety checks"
    [ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set (load it from the environment you intend to migrate; it is never printed)."
    label="$(printf '%s' "${DATABASE_ENV_LABEL:-}" | tr 'A-Z' 'a-z')"
    [ -n "$label" ] || fail "DATABASE_ENV_LABEL is not set, so this database cannot be proven to belong to an environment."
    echo "Target database is labelled: $label"
    if [ "$label" = "production" ] && [ "$yes" != "yes" ]; then
      fail "This is the PRODUCTION database. Re-run with --yes once the backup below is real and the owner has agreed."
    fi

    step "1. Backup proof"
    [ -n "$backup_ref" ] || fail "Give --backup-ref describing the backup or Neon restore point taken just now (e.g. a backup code from Admin > Security Operations > Backups, or a Neon restore point name). A migration without a recoverable point is refused."
    echo "Recorded backup reference: $backup_ref"
    if command -v pg_dump >/dev/null 2>&1 && [ -n "${BACKUP_DIR:-}" ]; then
      mkdir -p "$BACKUP_DIR"
      out="$BACKUP_DIR/pre-migrate-$(date -u +%Y%m%dT%H%M%SZ).dump"
      pg_dump --format=custom --no-owner --file "$out" "$DATABASE_URL" && echo "Extra pg_dump written to $out (store it somewhere safe; it contains personal data)."
    else
      echo "(pg_dump / BACKUP_DIR not set - relying on the backup reference above.)"
    fi

    step "2. Validate migrations"
    node scripts/check-migrations.mjs
    npx prisma validate

    step "3. Migrate (versioned migrations only)"
    node scripts/migrate-deploy.mjs

    step "4. Integrity"
    node scripts/migrate-deploy.mjs --status
    echo "Schema and migration history are in sync. Now run the in-app integrity check: Admin > System Health > Integrity."
    echo
    echo "Next: merge the pull request so Vercel deploys, then run:  scripts/deploy-db.sh post --url <site> --expect-commit <sha>"
    ;;

  post)
    step "5. Wait for the new version"
    [ -n "$url" ] || fail "Give --url https://your-site (or set BASE_URL)."
    case "$url" in https://*) ;; *) fail "The site address must start with https://";; esac
    ok=no
    for i in $(seq 1 30); do
      body="$(curl -fsS --max-time 15 "$url/api/health/live" 2>/dev/null || true)"
      if printf '%s' "$body" | grep -q '"ok"'; then ok=yes; break; fi
      sleep 10
    done
    [ "$ok" = "yes" ] || fail "The site did not answer /api/health/live within 5 minutes. Follow docs/runbooks/rollback.md."
    if [ -n "$expect_commit" ]; then
      echo "Expected commit: ${expect_commit:0:7} - confirm it on Admin > Deployment & Go-Live (Release tab)."
    fi

    step "6. Smoke test (no login needed)"
    node scripts/smoke.mjs --url "$url"
    node scripts/security-smoke.mjs --url "$url"
    echo
    echo "Smoke tests passed. Log in and check Admin > Production Readiness and Admin > Deployment & Go-Live."
    ;;

  *)
    echo "Usage: scripts/deploy-db.sh pre|post [options]   (see the header of this file)" >&2
    exit 2
    ;;
esac

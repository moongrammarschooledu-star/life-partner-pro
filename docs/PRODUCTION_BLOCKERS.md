# Production blockers — STEP 33

A blocker is an unresolved issue from the critical-issue gate: authentication or authorisation bypass, sensitive, contact or document
leakage, payment-verification bypass, privilege escalation, secret exposure, injection, broken RLS, broken maker-checker, backup failure
without an accepted recovery plan, a broken production migration, or a broken critical applicant workflow.

## Blocking today (the live site, commit 35371fe)

| # | Blocker | State | What clears it |
|---|---|---|---|
| 1 | Applicant sign-in is Profile ID + e-mail address only (authentication weakness; the Profile ID is visible to the other party of a proposal) | **Fixed in this branch, not deployed** | Deploy this branch, then sign in once as an applicant and confirm the code e-mail arrives. The fix is on by default (`auth.applicant_otp_login.enabled`). |
| 2 | Applicant sessions could be un-revoked by dropping one cookie | **Fixed in this branch, not deployed** | Deploy this branch. |
| 3 | Assignment-scoped staff could reach notes, matches and change-request approval of profiles not assigned to them | **Fixed in this branch, not deployed** | Deploy this branch. |
| 4 | Hidden phone numbers could be probed through the profile list and global search | **Fixed in this branch, not deployed** | Deploy this branch. |
| 5 | A refund could be sent to the provider twice by two simultaneous executions | **Fixed in this branch, not deployed** | Deploy this branch. |

The live site stays NOT_READY until this branch is deployed. After deployment no blocker from this audit remains open.

## Not blockers, but open (see the audit report for the full list)

* Restore is proven for the database and administrator sign-in only; file restore and the critical workflows are not yet verified (a
  recovery plan exists and daily backups are verified on creation, so this is a warning, not a blocker).
* The Neon database password should be rotated (it was pasted into a chat; the owner is the only user of the machine).
* No browser end-to-end suite, no load test at 100k to 500k profiles, no accessibility or device audit.
* Row-level security is not used; authorisation is enforced and tested in the application layer.

## Accepted by design

* Staff with a profile view permission see list thumbnails of every profile in the list (the list view); this is why the photo route is
  not assignment-gated. Verification work is queue-based, so its routes are not assignment-gated either. Both are pinned by
  `profile-route-assignment.test.ts`; a new profile route fails that test until it enforces the assignment or is added with a reason.
* Preview deployments fail on purpose unless they carry their own database label (`DATABASE_ENV_LABEL`).

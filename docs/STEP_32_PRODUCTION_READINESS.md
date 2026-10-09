# STEP 32 — Production readiness

## Verdict for this release

**READY_WITH_WARNINGS** — the code is complete, tested and safe to deploy **because everything new is switched off by default**; none of the controls is claimed to be working in production until it has been switched on and checked there.

The states used throughout the product are `NOT_READY`, `READY_WITH_WARNINGS` and `PRODUCTION_READY`. They are **computed**, not declared: the Security Operations overview calculates the live verdict on every visit from real evidence (see below). This page is the build-time assessment of the release; the overview is the running system's assessment.

## What was delivered

| Required deliverable | Status |
|---|---|
| Functional Security Operations Center (overview, alerts, incidents, rules, admin security, backups, restore drills, disaster recovery, configuration, audit) | **Built.** 10 screens + incident detail, 21 API routes, all behind `soc.enabled` (off). Not yet exercised against a live database. |
| Threat detection and alert management | **Built and tested.** 25 versioned rules, dry-run testing, alerts with the full lifecycle, escalation, duplicate suppression. Daily cadence + on demand. |
| Incident response workflows | **Built and tested.** Eight stages with entry requirements, evidence pointers, timeline, containment with second-person approval. |
| Administrator and session security | **Built and tested.** Idle timeout, session cap, new-device signal, step-up, MFA coverage and optional enforcement (all off until set). |
| API and webhook protection | **Verified and extended.** All six inbound webhook families verify signatures and report failures as security events; rate-limit refusals recorded; coverage enforced by tests. CSP remains report-only (owner decision). |
| AI security monitoring | **Built and tested.** Prompt-injection and restricted-action patterns recorded as pattern codes; structural guarantee that AI code cannot approve, grant, delete, refund, restore, contain or send. |
| Verified backup and restore procedures | **Backups already existed and are now monitored honestly. Restore procedure documented; restore drills built.** The restore itself has **not** been proven — see below. |
| Disaster recovery documentation | **Built.** Versioned plan in-app, configured vs measured objectives kept apart; guide in `docs/`. The plan *content* for this deployment still has to be written and approved by the owner. |
| Automated security tests | **200 new tests, all passing** (2417 in the repository). See the test report. |
| Production readiness report | This document. |

## Warnings that keep this from PRODUCTION_READY

1. **No restore has been proven.** Proof needs a restore drill into an isolated database, signed off by a second person. The owner must provide a scratch database (for example a Neon branch). Until then the overview shows *Restore proven: No*.
2. **Stored files are at public, unguessable addresses** (encrypted; keys server-side; addresses never returned by an API). The storage service has no private mode in use here. Shown as a standing warning.
3. **CSP is report-only.** Review reported violations, then set `CSP_MODE=enforce`.
4. **Detection is daily, not real-time**, and the **thresholds are untuned starting points.** Use the dry run on real traffic.
5. **Second step for privileged administrators is not enforced** until the owner turns it on (it relies on e-mail delivery of codes; confirm delivery first).
6. **No approved disaster-recovery plan or recovery test exists yet**; no objective is *measured* yet.
7. **The new screens and migrations have not run against a live database.** The deployment applies the migrations; the first live check is made with the switches off.

## What the overview will say on first use (expected, not measured)

| Check | Expected | Why |
|---|---|---|
| Threat detection is running | WARN | Off until `soc.detection.enabled` is switched on and run once |
| Unacknowledged alerts are escalated | WARN | Off until `soc.escalation.enabled` |
| No open critical findings | PASS | Nothing has been raised yet |
| Backups are current and verified | PASS if the existing daily backup + verification are healthy, else WARN/FAIL | Read from the real backup records |
| A restore has been proven | WARN | No drill yet |
| Stored files are not publicly addressable | WARN | See warning 2 |
| A disaster-recovery plan is approved | WARN | No plan yet |
| RPO / RTO | PASS or FAIL for RPO from the newest verified backup; WARN for RTO | RTO has no approved drill |
| Recovery tests on schedule | PASS | No schedule set |
| Privileged administrators have a second step | WARN if any privileged administrator relies on no second step | Read from the real accounts |
| Idle administrator sessions end | WARN | No idle timeout set |
| CSP enforced | WARN | Report-only |

So the live verdict is expected to start at **READY_WITH_WARNINGS** (or **NOT_READY** if backups turn out to be unhealthy). It becomes **PRODUCTION_READY** only when every row passes on real evidence.

## How to bring it live

1. Merge and deploy (the migrations are additive and apply automatically). Nothing changes for any user.
2. Sign in as Super Admin. Turn on `soc.enabled`. Open **Security Operations**; read the Overview.
3. Set the security configuration you want (idle timeout, session cap; leave the second-step enforcement off until e-mail delivery is confirmed).
4. Turn on `soc.detection.enabled`; press **Run now**. Open **Detection rules**; use the dry run to tune anything noisy.
5. Turn on `soc.escalation.enabled`.
6. Write and approve the disaster-recovery plan (two different administrators). Record a tabletop test.
7. Create a scratch database; turn on `soc.restore_drills.enabled`; run the first restore drill; have a second administrator sign it off.
8. Review the Overview again; work through each remaining warning.

## Manual configuration that only the owner can do

- The scratch database for restore drills; enabling point-in-time recovery in the database console and testing it.
- A safe copy of `BACKUP_ENCRYPTION_KEY` outside the hosting account.
- Writing the recovery plan contents and choosing RPO/RTO targets in System Control.
- Deciding when to enforce CSP and when to enforce the second step.
- A second Super Admin account, so every approval has a second person.

## What is deliberately *not* claimed

- That any rule has caught a real attack (none has run on live traffic).
- That the backup can be restored (only a drill can show that).
- That recovery will meet any particular time.
- That detection is real-time.
- That an isolated restore, a penetration test or a load test has been done.

## References

[Security operations center](SECURITY_OPERATIONS_CENTER.md) · [Threat detection rules](THREAT_DETECTION_RULES.md) · [Incident response plan](INCIDENT_RESPONSE_PLAN.md) · [Administrator security guide](ADMIN_SECURITY_GUIDE.md) · [Backup and restore guide](BACKUP_AND_RESTORE_GUIDE.md) · [Disaster recovery plan](DISASTER_RECOVERY_PLAN.md) · [Security test report](SECURITY_TEST_REPORT.md)

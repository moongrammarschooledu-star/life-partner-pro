# Administrator security guide

## Who counts as privileged

An administrator is **privileged** when their effective permissions (role or custom role) include anything hard to undo or that widens other people's access: managing administrators, changing system configuration or emergency switches, approving restores, managing feature switches, approving containment, changing security configuration, exporting finance data, suspending accounts, or seeing sensitive analytics. The list is in `src/lib/soc/admin-security.ts`.

## Second step at sign-in

Sign-in already supports a one-time code sent to the administrator's e-mail. It is required when the administrator turned on two-factor for themselves, or their role is on the **required roles** list (Settings). This step adds one more option:

- **Require the one-time code for privileged administrators** (Security Operations → Configuration). **Off by default**, so switching the SOC on never locks anyone out. When on, every privileged administrator completes the code step at every sign-in, whatever their personal setting.
- **Admin security → Second-step coverage** lists privileged, active administrators who currently sign in with *no* second step, with the reason.

> The code is e-mailed, so it is only as strong as the e-mail account and the e-mail delivery. Until a real e-mail provider is connected, codes only reach the server log (see the deployment guide) — treat log access as sensitive. If e-mail delivery fails, `scripts/admin-recovery.mjs` lets the owner recover an account from a trusted machine.

## Sessions

Every sign-in creates a revocable session, checked on every request.

- **Idle timeout** (Configuration, empty = none): a session unused for that many minutes ends on its next request; the person signs in again. Recorded as a session anomaly.
- **Concurrent session cap** (Configuration, empty = none): a new sign-in beyond the cap ends the **oldest** sessions. The new session is never the one ended.
- **New device**: a sign-in from a browser/device the administrator has not used in the past 90 days (and which is not their first-ever sign-in) is recorded and counted by a rule.
- **Seeing sessions**: Admin security lists live sessions with the device and a **shortened** address (`203.0.113.…`).
- **Ending sessions**: any administrator can end their own sessions and a Super Admin can end another's, using the existing session-revoke action. During an attack, request **containment** from the incident instead — it is recorded on the incident and, for all of a person's sessions, needs a second person's approval.

Both limits are **off until set**, and the policy fails open: if the setting cannot be read, nobody is locked out.

## Password re-confirmation (step-up)

These actions ask the administrator for their password again, and refuse without a fresh token bound to **that** administrator (5 minutes): approving containment, changing or reviewing a detection rule, saving security configuration, approving a recovery plan, reviewing a restore drill. It can be switched off in Configuration, but it is **on by default** and switching it off is itself an audited configuration change.

## Privilege changes

- Only someone who is allowed to grant a role or permission can grant it; nobody can raise their own. This is enforced by the role-management service, not by the screen.
- Every role, custom-role or permission change is audited (who, what, when) and is also recorded as a security event. **Admin security → Privilege changes** lists the last 30 days; a rule flags an unusual number by one administrator.
- Sensitive permissions (contact details, income, family, finance export, security operations…) are never implied by holding a broad role; they are granted, or not, role by role.

## Break-glass (emergency) access

Break-glass access is deliberately narrow: it can reveal one contact or open one case, it **expires**, it needs a written reason, and every grant and every use is audited. It is **not** a way to widen privileges. Use of it is counted by a rule that raises a HIGH alert, so a human always reviews it. **Admin security → Break-glass** lists grants and whether they were used.

## Least privilege

Staff roles hold **no** Security Operations permission. Compliance can *request* containment but only a Super Admin can *approve* it. Give people the narrowest role that does their job, and use custom roles for exceptions rather than SUPER_ADMIN.

## Keeping the owner account safe

- Keep at least two Super Admin accounts so that an approval always has a second person; never share a login.
- Use the second step. Enforce it for privileged roles once e-mail delivery is reliable.
- Review **Admin security** and the **Audit** screen regularly; both are read-only.
- Treat the audit log as evidence: it is append-only in the application (a test enforces that nothing edits or deletes an audit row except the retention sweep).

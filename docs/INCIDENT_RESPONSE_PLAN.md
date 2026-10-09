# Incident response plan

An **incident** is a tracked response to something confirmed or strongly suspected: an attack in progress, a suspected exposure, a failed backup. It is a record with an owner and a timeline, not a verdict about anyone. Incident numbers use the same `LPP-INC-######` sequence as the existing system incidents.

## When to open one

Open an incident when an alert (or anything else) needs a coordinated response rather than a single fix: repeated attacks on sign-in, a webhook endpoint being spoofed, an administrator account that may be exposed, unexpected data export, a backup that cannot be trusted, a provider outage with security impact. A single alert that can be resolved on its own does not need one. An incident can be opened from scratch, or from one or more alerts (which are then linked to it as evidence).

**Categories:** account compromise · authentication attack · authorization failure · data exposure · privacy incident · malware or malicious attachment · API attack · webhook compromise · payment security incident · AI security incident · document access incident · backup or recovery failure · third-party provider incident.

**Severity:** INFO · LOW · MEDIUM · HIGH · CRITICAL. Severity is a judgement about impact and urgency, set by the person opening it and changeable as facts emerge.

## The eight stages

`DETECTED → TRIAGED → INVESTIGATING → CONTAINMENT → REMEDIATION → RECOVERY → POST_INCIDENT_REVIEW → CLOSED`

| Stage | What happens | What the system requires to enter it |
|---|---|---|
| Detected | The incident is opened with a title, category, severity and a description with **no personal details**. | — |
| Triaged | Confirm it is real, set severity and category, **assign an owner**. | An owner who holds `soc:incidents:manage`. |
| Investigating | Establish what happened and how far it reached. Link evidence. Add notes. | — |
| Containment | Stop it spreading with technical, time-limited controls (see below). | — |
| Remediation | Remove the cause: reset credentials, fix the weakness, tighten a rule. | A written note of what was done — or why no containment was needed (this is also how containment is skipped). |
| Recovery | Return to normal operation; verify. | — |
| Post-incident review | Write what actually caused it. | **Root cause recorded** (at least 20 characters). |
| Closed | Final. A closed incident cannot be edited. | Root cause and **lessons learned** recorded; for HIGH or CRITICAL, the **communication plan** recorded; **no containment request still waiting**. |

An incident moves one stage at a time. It may go from *Investigating* straight to *Remediation* when nothing needs containing, and it may be taken back to *Investigating* from Containment, Remediation or Recovery when new facts appear. Every move, note, evidence link and containment step is written to the incident's timeline with who did it and when.

## Evidence

Evidence is a **pointer** — a type (security event, alert, audit entry, backup run, webhook event, AI request, risk case, case, admin session, other) and an identifier. Copies of data, names, e-mail addresses and free text are refused. Open the underlying record through its own screen, which applies its own permissions.

## Containment

Containment is a **technical, time-limited control against an active attack**. It is never a decision about a person: it throttles or blocks an access path, ends a session, or turns on an emergency switch. Every control expires by itself within 24 hours, is applied by a named human with a written reason, and is audited.

| Action | Runs immediately when… | Needs a second person when… |
|---|---|---|
| End one administrator session | always (it is narrow) | — |
| End **all** sessions of an administrator | never | always |
| Throttle an account / profile / administrator | 120 minutes or less | longer than 120 minutes |
| Block a network (by its hash) | 60 minutes or less | longer than 60 minutes |
| Turn on an emergency switch (payments, registrations, profile submissions, matching, proposals, notifications, uploads, public access) | never | always |

Rules the system enforces whatever a screen sends:

- Requesting needs `soc:containment:request`; approving needs `soc:containment:approve`, which only SUPER_ADMIN holds.
- **Nobody approves their own request.** Nobody can request, or approve, an action whose target is their own account.
- Approving asks for the approver's password again.
- Containment can be requested only while the incident is being investigated, contained or remediated.
- An emergency switch is only ever turned **on** here. Turning it back off is done in System Control once it is safe.

## Communication

Record a **communication plan** on the incident: who must be told, when, and by whom (for example the account owners affected, the payment provider, or the regulator if the law requires). For a privacy incident, also open the existing privacy case so the legal and regulatory workflow applies. The SOC sends in-app notices to staff only, and they carry a code, a severity and a category — never applicant details. Nothing in the SOC sends a message to an applicant.

## After the incident

- Record the **root cause** and the **lessons learned** (what to change in rules, thresholds, configuration or process). Use the rule **dry run** to test a tighter rule before saving it.
- If an alert rule was too noisy or too quiet, change it as a new version with the reason written down.
- Review who had access, and whether a permission should be narrower.

## Escalation of unacknowledged alerts

When enabled, an alert nobody acknowledges is escalated: after N minutes (set per severity in Configuration; default 15 for CRITICAL, 60 for HIGH, 480 for MEDIUM) the people who can approve containment are notified, and after twice that, responders and approvers together are. INFO and LOW never escalate. Every escalation is audited and appears on the alert's history.

## Roles

| Role | Part in an incident |
|---|---|
| Incident owner (any holder of `soc:incidents:manage`) | Runs the incident, keeps the timeline, writes the review |
| Compliance manager | Opens and works incidents, requests containment, reviews restore drills |
| Super admin | Approves broad containment, changes rule strength and configuration |
| Operations admin | Sees alerts, backup and recovery state; records restore drills |

## If the SOC itself is unavailable

The screens depend on the application and database. If they are unreachable, use the existing operations tools: System Health, the runbooks (Admin → Runbooks), the platform provider's console, and `scripts/admin-recovery.mjs` for owner-run account recovery. Record what was done in an incident afterwards.

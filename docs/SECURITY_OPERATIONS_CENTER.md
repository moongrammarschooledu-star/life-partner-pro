# Security Operations Center

The Security Operations Center (SOC) gives the owner and the compliance and operations leads one place to see, and respond to, security events across Life Partner Pro. It sits on top of the security machinery that earlier steps built — the security event pipeline, the administrator session and login records, break-glass access, the encrypted backups and their verification, the system-control targets and the AI safety filters — and joins them. Nothing was rebuilt or removed.

**Principles**

1. **Only real figures.** Every number on every screen is a count or status read from the database when the page opens, with its source named. An empty system shows zero and "none yet", never a placeholder that looks like data.
2. **Detection never acts on a person.** Rules raise alerts. People decide. Wording is neutral ("suspicious activity detected"), never an accusation.
3. **Humans approve what is broad.** A narrow, short containment action runs at once; a broad or long one needs a different person. Nobody approves their own request, and nobody can be the target of their own containment.
4. **Nothing is shown as working unless it is proven.** A backup is "healthy" only when it completed, passed verification and is fresh. A restore is "proven" only when an independently reviewed drill passed. Recovery objectives are shown as *configured* and *measured* separately.
5. **Minimum data.** Events keep identifiers and counts, with network and account identifiers salted-hashed. Alert and incident evidence is a *pointer*, never a copy. Notices to staff carry a code, a severity and a category — no applicant details.

## Screens

All live under `/admin/security-operations` and are hidden entirely until `soc.enabled` is switched on.

| Screen | Purpose | View permission |
|---|---|---|
| Overview | Readiness verdict, open alerts and incidents, 24-hour signals, administrator security, database/storage health, backup and restore status, recovery objectives, recent security audit | `soc:view` |
| Alerts | Work an alert: acknowledge → investigate → resolve (written reason required), false positive, escalate, assign, add notes | `soc:alerts:view` (act: `soc:alerts:manage`) |
| Incidents | Open and run an incident through the eight stages; evidence references; containment requests and approvals; root cause, lessons learned, communication plan | `soc:incidents:view` (act: `soc:incidents:manage`, `soc:containment:request`, `soc:containment:approve`) |
| Detection rules | See every rule, test a change against the past, save a new version, review a proposed one | `soc:rules:view` (change: `soc:rules:manage`) |
| Admin security | Second-step coverage, live sessions (addresses shortened), privilege changes, break-glass use, sign-in counts | `soc:admin_security:view` |
| Backups | Backup status exactly as recorded; storage and retention facts; never locations or keys | `soc:backups:view` |
| Restore drills | Rehearse and record a restore into an isolated environment; independent sign-off | `soc:backups:view` (record: `soc:restore:record`, review: `soc:restore:review`) |
| Disaster recovery | Approved plan, configured vs measured RPO/RTO, recovery tests | `soc:dr:view` (change: `soc:dr:manage`) |
| Configuration | Versioned security settings and their history | `soc:config:view` (change: `soc:config:manage`) |
| Audit | Who opened which screen; every Security Operations change | `soc:audit:view` |

Role defaults: **SUPER_ADMIN** holds every `soc:*` permission. **COMPLIANCE_MANAGER** can view, work alerts and incidents, *request* containment, review restore drills and read the audit. **OPERATIONS_ADMIN** can view alerts, backups and recovery, and record restore drills. No staff, viewer, analyst or domain-manager role holds any `soc:*` permission. Only SUPER_ADMIN can approve containment, change rule strength, change configuration, run detection by hand or approve a recovery plan.

## Switches

All default **OFF**; deploying changes nothing by itself.

| Switch | Effect |
|---|---|
| `soc.enabled` | The screens and APIs exist. With it off every SOC API answers 404 and nothing is read. |
| `soc.detection.enabled` | The daily detection run and "Run now" evaluate rules and raise alerts. |
| `soc.escalation.enabled` | Unacknowledged alerts are escalated to the next tier. |
| `soc.restore_drills.enabled` | Restore drills can be started, recorded and reviewed. |

Recommended order: `soc.enabled` → review the Overview and Detection rules → `soc.detection.enabled` and press **Run now** → check the dry-run results and tune → `soc.escalation.enabled` → `soc.restore_drills.enabled` when a scratch database is ready.

## Events

Rules read the existing security event table. This step added fourteen event types and the places that record them — see *Threat detection rules → Event sources*. Recording is **fail-open**: a failure to record an event never changes what a request returns.

## Data kept

| Table | Holds | Retention |
|---|---|---|
| `SocAlert`, `SocAlertEvent` | Alerts and their history | Closed alerts that belong to no incident: 730 days (configurable). Alerts that are part of an incident are never swept. |
| `SocIncident`, `SocIncidentEvent`, `SocContainmentAction` | Incidents, timeline, containment | Kept (they are the record of how an incident was run). |
| `SocDetectionRule`, `SocRuleVersion` | Rule identity and every version | Kept. |
| `SocSettings`, `SocConfigVersion` | Configuration and every change | Kept. |
| `SocAccessLog` | Who opened which screen (no data) | 365 days (configurable). |
| `RestoreDrill`, `DisasterRecoveryPlan`, `DisasterRecoveryTest` | Drills, plan versions, recovery tests | Kept. |
| `SecurityEvent` (existing) | Raw events | 90 days (existing sweep; never deletes events tied to an open case or a legal hold). |

## Sensitive-data control matrix

For each class of data: where access is decided on the server, what limits which fields are visible, where it is stored, how it can leave, the audit trail, and the test that pins it. Generated from `src/lib/soc/control-matrix.ts`; a test confirms every file it names still exists.

<!-- BEGIN GENERATED:matrix -->
### Applicant contact details
- **Where access is decided (server side):** `src/lib/privacy/contact-access.ts`, `src/app/api/admin/profiles/[id]/contact/route.ts`
- **Field / record control:** sensitive:contact:view, plus an approved contact-sharing permission between the two parties; break-glass is limited to a contact or a case and expires
- **Storage:** Database (profile contact fields); never placed in a URL, a log line or an error message
- **How it can leave the system:** Excluded from list serialisers and from reports; the privacy export is produced only for the applicant themself
- **Audit trail:** CONTACT_VIEWED audit entry on every view, mirrored to SENSITIVE_RECORD_ACCESS for burst detection
- **Tests:** `src/lib/privacy/contact-access.test.ts`, `src/lib/serializers.test.ts`

### Matrimonial profiles
- **Where access is decided (server side):** `src/lib/serializers.ts`, `src/lib/profile-assignment-access.ts`, `src/lib/route-guard.ts`
- **Field / record control:** Field-level serialisation by permission (income, family and notes are separate sensitive permissions); staff see only profiles assigned to them
- **Storage:** Database; photos are encrypted before they reach object storage
- **How it can leave the system:** Reports and exports are permission-gated and audited; no export includes contact details
- **Audit trail:** Profile access and search audit entries; search volume is watched by a detection rule
- **Tests:** `src/lib/serializers.test.ts`, `src/lib/profile-assignment-access.test.ts`

### Family records
- **Where access is decided (server side):** `src/lib/serializers.ts`, `src/lib/ai/load.ts`
- **Field / record control:** sensitive:family:view; a family member's own access is limited to what the applicant granted
- **Storage:** Database
- **How it can leave the system:** Not part of any bulk export; AI input excludes it unless the viewer holds the permission
- **Audit trail:** Sensitive data access audit entries
- **Tests:** `src/lib/serializers.test.ts`

### Verification documents
- **Where access is decided (server side):** `src/lib/verification/document-storage.ts`, `src/lib/verification-access.ts`, `src/app/api/admin/verification/[profileId]/evidence/route.ts`
- **Field / record control:** sensitive:verification:view for the file itself
- **Storage:** AES-GCM encrypted before upload; the key stays on the server
- **How it can leave the system:** No bulk export of documents; a download is a single, audited request
- **Audit trail:** VERIFICATION_DOCUMENT_DOWNLOADED, mirrored to SENSITIVE_RECORD_ACCESS
- **Tests:** `src/lib/security/event-bus.test.ts`
- **Known limit:** The encrypted object sits at a public but unguessable address; the content cannot be read without the server-held key.

### Identity information
- **Where access is decided (server side):** `src/lib/verification-access.ts`, `src/lib/privacy/data-classification.ts`
- **Field / record control:** Identity-check results are shown to verification staff only; analytics shows counts only (analytics:sensitive:view)
- **Storage:** Database; provider references only, never provider secrets
- **How it can leave the system:** Excluded from exports and from AI input
- **Audit trail:** Verification and sensitive access audit entries
- **Tests:** `src/lib/privacy/data-classification.test.ts`

### Private messages
- **Where access is decided (server side):** `src/lib/communication-access.ts`, `src/lib/communications/retention.ts`
- **Field / record control:** communication:view and record-level access; message bodies are redacted after the retention period
- **Storage:** Database (communication log); provider webhooks are signature-verified
- **How it can leave the system:** Communication analytics are aggregate counts; no message export
- **Audit trail:** Communication audit entries; suppression and consent are checked before any send
- **Tests:** `src/lib/privacy/data-classification.test.ts`

### AI conversation records
- **Where access is decided (server side):** `src/lib/ai/pipeline.ts`, `src/lib/ai/load.ts`
- **Field / record control:** The AI only sees data the signed-in administrator is already allowed to see; restricted fields are removed before any provider call
- **Storage:** Structured results with a storage mode and an expiry; typed text is not stored
- **How it can leave the system:** None; results expire (see the AI retention sweep)
- **Audit trail:** AiRequest rows (status, feature, versions) and AI audit actions; prompt text is never recorded
- **Tests:** `src/lib/ai/pipeline.test.ts`, `src/lib/ai/retention.test.ts`

### Payment and subscription records
- **Where access is decided (server side):** `src/lib/route-guard.ts`, `src/app/api/webhooks/payments/[provider]/route.ts`
- **Field / record control:** finance:* permissions; full card data is never stored (provider tokens only); refunds need re-authentication
- **Storage:** Database, integer minor units per currency
- **How it can leave the system:** Financial exports need their own permission and write FINANCIAL_REPORT_EXPORTED
- **Audit trail:** Payment and refund audit entries; webhook deliveries are idempotent
- **Tests:** `src/lib/finance/refund.test.ts`, `src/lib/finance/money.test.ts`

### Staff internal notes
- **Where access is decided (server side):** `src/app/api/admin/profiles/[id]/notes/[noteId]/route.ts`, `src/lib/serializers.ts`
- **Field / record control:** sensitive:notes:view
- **Storage:** Database
- **How it can leave the system:** Excluded from every serialiser that leaves the staff area
- **Audit trail:** Note access audit entries
- **Tests:** `src/lib/serializers.test.ts`
<!-- END GENERATED:matrix -->

## Honest limits

- **Cadence:** detection runs once a day and on demand; it is not real-time monitoring.
- **Stored files** (photos, documents, evidence, exports, backups) are encrypted before upload with keys held only by the server, but the storage service gives each object a public, unguessable address. The addresses are never returned by any API. Moving to private storage is a recommended follow-up; the readiness check keeps showing a warning until then.
- **Content-Security-Policy** is in *report-only* mode until `CSP_MODE=enforce` is set. That is an owner decision after reviewing reported violations.
- **Rate limiting** of public endpoints uses a database-backed counter shared by all server instances; a few internal helpers still use a per-instance counter and are not counted as security events.
- **Prompt-injection detection** is pattern based and advisory. The real protections are the permission checks, consent rules, the read-only copilot and the output safety filter, none of which depend on it.
- **An isolated restore** can only be proven with a scratch database the owner creates; until a drill is completed and approved, "restore proven" stays *No*.
- The thresholds are starting points, not measurements.

## Related documents

[Threat detection rules](THREAT_DETECTION_RULES.md) · [Incident response plan](INCIDENT_RESPONSE_PLAN.md) · [Administrator security guide](ADMIN_SECURITY_GUIDE.md) · [Backup and restore guide](BACKUP_AND_RESTORE_GUIDE.md) · [Disaster recovery plan](DISASTER_RECOVERY_PLAN.md) · [Security test report](SECURITY_TEST_REPORT.md) · [Production readiness](STEP_32_PRODUCTION_READINESS.md)

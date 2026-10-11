// STEP 32 — the sensitive-data control matrix. For each class of data the spec names: where access is enforced on the server, where and how
// it is stored, the only paths by which it can leave, and the test that pins the behaviour. It is plain data so a test can check that every
// file it points at still exists — a matrix that quietly goes stale is worse than none. It documents what the code does; it does not grant
// anything. Where a control is weaker than the ideal, the `limit` field says so in plain words.

export interface DataControl {
  dataClass: string;
  authorization: string[]; // files where access is decided on the server (never the browser)
  fieldControl: string; // the permission or rule that limits which parts of a record are visible
  storage: string;
  exportPath: string; // how this data can leave the system, and what protects that path
  audited: string; // the audit/log trail of access
  tests: string[];
  limit?: string;
}

export const CONTROL_MATRIX: DataControl[] = [
  {
    dataClass: "Applicant contact details",
    authorization: ["src/lib/privacy/contact-access.ts", "src/app/api/admin/profiles/[id]/contact/route.ts"],
    fieldControl: "sensitive:contact:view, plus an approved contact-sharing permission between the two parties; break-glass is limited to a contact or a case and expires",
    storage: "Database (profile contact fields); never placed in a URL, a log line or an error message",
    exportPath: "Excluded from list serialisers and from reports; the privacy export is produced only for the applicant themself",
    audited: "CONTACT_VIEWED audit entry on every view, mirrored to SENSITIVE_RECORD_ACCESS for burst detection",
    tests: ["src/lib/privacy/contact-access.test.ts", "src/lib/serializers.test.ts"],
  },
  {
    dataClass: "Matrimonial profiles",
    authorization: ["src/lib/serializers.ts", "src/lib/profile-assignment-access.ts", "src/lib/route-guard.ts"],
    fieldControl: "Field-level serialisation by permission (income, family and notes are separate sensitive permissions); staff see only profiles assigned to them",
    storage: "Database; photos are encrypted before they reach object storage",
    exportPath: "Reports and exports are permission-gated and audited; no export includes contact details",
    audited: "Profile access and search audit entries; search volume is watched by a detection rule",
    tests: ["src/lib/serializers.test.ts", "src/lib/profile-assignment-access.test.ts"],
  },
  {
    dataClass: "Family records",
    authorization: ["src/lib/serializers.ts", "src/lib/ai/load.ts"],
    fieldControl: "sensitive:family:view; a family member's own access is limited to what the applicant granted",
    storage: "Database",
    exportPath: "Not part of any bulk export; AI input excludes it unless the viewer holds the permission",
    audited: "Sensitive data access audit entries",
    tests: ["src/lib/serializers.test.ts"],
  },
  {
    dataClass: "Verification documents",
    authorization: ["src/lib/verification/document-storage.ts", "src/lib/verification-access.ts", "src/app/api/admin/verification/[profileId]/evidence/route.ts"],
    fieldControl: "sensitive:verification:view for the file itself",
    storage: "AES-GCM encrypted before upload; the key stays on the server",
    exportPath: "No bulk export of documents; a download is a single, audited request",
    audited: "VERIFICATION_DOCUMENT_DOWNLOADED, mirrored to SENSITIVE_RECORD_ACCESS",
    tests: ["src/lib/security/event-bus.test.ts"],
    limit: "The encrypted object sits at a public but unguessable address; the content cannot be read without the server-held key.",
  },
  {
    dataClass: "Identity information",
    authorization: ["src/lib/verification-access.ts", "src/lib/privacy/data-classification.ts"],
    fieldControl: "Identity-check results are shown to verification staff only; analytics shows counts only (analytics:sensitive:view)",
    storage: "Database; provider references only, never provider secrets",
    exportPath: "Excluded from exports and from AI input",
    audited: "Verification and sensitive access audit entries",
    tests: ["src/lib/privacy/data-classification.test.ts"],
  },
  {
    dataClass: "Private messages",
    authorization: ["src/lib/communication-access.ts", "src/lib/communications/retention.ts"],
    fieldControl: "communication:view and record-level access; message bodies are redacted after the retention period",
    storage: "Database (communication log); provider webhooks are signature-verified",
    exportPath: "Communication analytics are aggregate counts; no message export",
    audited: "Communication audit entries; suppression and consent are checked before any send",
    tests: ["src/lib/privacy/data-classification.test.ts"],
  },
  {
    dataClass: "AI conversation records",
    authorization: ["src/lib/ai/pipeline.ts", "src/lib/ai/load.ts"],
    fieldControl: "The AI only sees data the signed-in administrator is already allowed to see; restricted fields are removed before any provider call",
    storage: "Structured results with a storage mode and an expiry; typed text is not stored",
    exportPath: "None; results expire (see the AI retention sweep)",
    audited: "AiRequest rows (status, feature, versions) and AI audit actions; prompt text is never recorded",
    tests: ["src/lib/ai/pipeline.test.ts", "src/lib/ai/retention.test.ts"],
  },
  {
    dataClass: "Payment and subscription records",
    authorization: ["src/lib/route-guard.ts", "src/app/api/webhooks/payments/[provider]/route.ts"],
    fieldControl: "finance:* permissions; full card data is never stored (provider tokens only); refunds need re-authentication",
    storage: "Database, integer minor units per currency",
    exportPath: "Financial exports need their own permission and write FINANCIAL_REPORT_EXPORTED",
    audited: "Payment and refund audit entries; webhook deliveries are idempotent",
    tests: ["src/lib/finance/refund.test.ts", "src/lib/finance/money.test.ts"],
  },
  {
    dataClass: "Staff internal notes",
    authorization: ["src/app/api/admin/profiles/[id]/notes/[noteId]/route.ts", "src/lib/serializers.ts"],
    fieldControl: "sensitive:notes:view",
    storage: "Database",
    exportPath: "Excluded from every serialiser that leaves the staff area",
    audited: "Note access audit entries",
    tests: ["src/lib/serializers.test.ts"],
  },
];

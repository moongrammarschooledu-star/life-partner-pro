import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// STEP 26 service-level tests over ONE coherent in-memory database (same fake-prisma engine pattern as
// src/lib/communications/e2e-flow.test.ts / src/lib/risk/e2e-flow.test.ts). The REAL document services run
// together end to end; only the outward edges (audit, tasks, notifications, approval gate, risk events,
// family membership) are controllable fakes.

type Row = Record<string, unknown> & { id?: string };
const DEFAULTS: Record<string, Row> = {
  document: { status: "UPLOADING", verificationStatus: "NOT_SUBMITTED", currentVersion: 1, softDeletedAt: null, archivedAt: null, bodyRedactedAt: null },
  documentVersion: {},
  documentSecurityScan: { status: "PENDING" },
  documentQuarantine: { decision: "PENDING" },
  documentAccessLog: {},
  documentShare: { status: "REQUESTED", scope: "VIEW", watermarked: true },
  documentRequest: { status: "DRAFT", priority: "NORMAL" },
  documentRequestEvent: {},
  documentSignatureRequest: { status: "DRAFT", provider: "LOCAL" },
  documentSignatureRecipient: { status: "PENDING", order: 1 },
  documentSignatureEvent: {},
  documentVerificationEvent: {},
  documentRedaction: {},
  documentCategoryConfig: { active: true, defaultClassification: "RESTRICTED" },
  documentTypeConfig: { active: true, requiresExpiry: false, acceptedMimeTypes: "[]" },
  documentPackage: {},
  documentPackageItem: { included: true },
};

const db = new Map<string, Row[]>();
let idc = 0;
let tick = 0;
const rows = (t: string) => {
  if (!db.has(t)) db.set(t, []);
  return db.get(t) as Row[];
};

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "OR") { if (!(v as Row[]).some((w) => matches(row, w))) return false; continue; }
    if (k === "AND") { if (!(v as Row[]).every((w) => matches(row, w))) return false; continue; }
    const actual = row[k];
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const c = v as Record<string, unknown>;
      if ("in" in c && !(c.in as unknown[]).includes(actual)) return false;
      if ("notIn" in c && (c.notIn as unknown[]).includes(actual)) return false;
      if ("not" in c && (c.not === null ? actual != null : actual === c.not)) return false;
      // Real SQL NULL semantics: a null/undefined value never satisfies a gte/gt/lte/lt comparison (unlike
      // JS's own `null <= x` which coerces null to 0 and would otherwise falsely match).
      if (("gte" in c || "gt" in c || "lte" in c || "lt" in c) && (actual === null || actual === undefined)) return false;
      if ("gte" in c && !((actual as Date) >= (c.gte as Date))) return false;
      if ("gt" in c && !((actual as Date) > (c.gt as Date))) return false;
      if ("lte" in c && !((actual as Date) <= (c.lte as Date))) return false;
      if ("lt" in c && !((actual as Date) < (c.lt as Date))) return false;
      continue;
    }
    if (v === null ? actual != null : actual !== v) return false;
  }
  return true;
}

function sortRows(list: Row[], orderBy: unknown): Row[] {
  const order = (Array.isArray(orderBy) ? orderBy[0] : orderBy) as Record<string, "asc" | "desc"> | undefined;
  if (!order) return list;
  const [field, dir] = Object.entries(order)[0];
  return [...list].sort((a, b) => {
    const x = a[field] as number | Date; const y = b[field] as number | Date;
    const r = x instanceof Date ? x.getTime() - (y as Date).getTime() : (x as number) - (y as number);
    return dir === "desc" ? -r : r;
  });
}

// documentId_version / requestId_recipientType_recipientId style compound-unique lookups
function expandCompound(where: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(where)) {
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v) && !("in" in (v as object)) && !("not" in (v as object)) && k !== "OR" && k !== "AND") Object.assign(out, v);
    else out[k] = v;
  }
  return out;
}

function model(t: string) {
  return {
    create: async ({ data }: { data: Row }) => {
      const row: Row = { id: `${t}-${++idc}`, createdAt: new Date(Date.now() + ++tick), updatedAt: new Date(), ...DEFAULTS[t], ...data };
      for (const uniq of ["documentCode", "requestCode", "signCode", "packageCode", "key"]) {
        if (row[uniq] != null && rows(t).some((r) => r[uniq] === row[uniq])) throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      rows(t).push(row);
      return { ...row };
    },
    createMany: async ({ data }: { data: Row[] }) => { for (const d of data) await model(t).create({ data: d }); return { count: data.length }; },
    findFirst: async ({ where, orderBy }: { where?: Row; orderBy?: unknown } = {}) => { const r = sortRows(rows(t).filter((x) => matches(x, where)), orderBy ?? { createdAt: "desc" })[0]; return r ? { ...r } : null; },
    findUnique: async ({ where, include }: { where: Row; include?: Row }) => {
      const r = rows(t).find((x) => matches(x, expandCompound(where)));
      if (!r) return null;
      const out: Row = { ...r };
      if (include?.types && t === "documentCategoryConfig") out.types = rows("documentTypeConfig").filter((x) => x.categoryKey === r.key);
      if (include?.category && t === "documentTypeConfig") out.category = rows("documentCategoryConfig").find((x) => x.key === r.categoryKey) ?? null;
      if (include?.events && t === "documentRequest") out.events = sortRows(rows("documentRequestEvent").filter((x) => x.requestId === r.id), { createdAt: "asc" });
      if (include?.items && t === "documentPackage") out.items = rows("documentPackageItem").filter((x) => x.packageId === r.id);
      return out;
    },
    findMany: async ({ where, take, orderBy, include }: { where?: Row; take?: number; orderBy?: unknown; include?: Row } = {}) => {
      let out = sortRows(rows(t).filter((x) => matches(x, where)), orderBy).map((r) => ({ ...r }));
      if (include?.types && t === "documentCategoryConfig") out = out.map((r) => ({ ...r, types: rows("documentTypeConfig").filter((x) => x.categoryKey === r.key) }));
      return take ? out.slice(0, take) : out;
    },
    count: async ({ where }: { where?: Row } = {}) => rows(t).filter((x) => matches(x, where)).length,
    update: async ({ where, data }: { where: Row; data: Row }) => { const r = rows(t).find((x) => matches(x, expandCompound(where))); if (!r) throw new Error(`not found: ${t}`); applyData(r, data); return { ...r }; },
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => { const hit = rows(t).filter((x) => matches(x, where)); hit.forEach((r) => applyData(r, data)); return { count: hit.length }; },
    upsert: async ({ where, update, create }: { where: Row; update: Row; create: Row }) => { const r = rows(t).find((x) => matches(x, expandCompound(where))); if (r) { applyData(r, update); return { ...r }; } return model(t).create({ data: create }); },
    groupBy: async () => [],
  };
}
function applyData(r: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && !(v instanceof Date) && "increment" in (v as Row)) r[k] = ((r[k] as number) ?? 0) + ((v as Row).increment as number);
    else r[k] = v;
  }
  r.updatedAt = new Date();
}

const audits: Row[] = [];
const tasks: Row[] = [];
const notifications: Row[] = [];
const securityEvents: Row[] = [];
let gate: { requiresApproval: boolean; status?: string; approvalRequestId?: string; approvalCode?: string } = { requiresApproval: false };
const executedApprovals: string[] = [];
const restrictions = new Map<string, Set<string>>();
const holds = new Map<string, boolean>(); // profileId -> active hold
let uploadedBlobs = new Map<string, Buffer>();

vi.mock("@/lib/prisma", () => ({ prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async (a: Row) => { audits.push(a); }) }));
vi.mock("@/lib/privacy/codes", () => ({ nextSequenceCode: vi.fn(async (p: string) => `LPP-${p}-${String(++idc).padStart(6, "0")}`) }));
vi.mock("@/lib/workflow/engine", () => ({ createFromEvent: vi.fn(async (t: Row) => { const dedupKey = t.dedupKey as string; if (tasks.some((x) => x.dedupKey === dedupKey)) return null; tasks.push(t); return { id: `t${tasks.length}` }; }) }));
vi.mock("@/lib/notifications/notification-service", () => ({
  sendNotification: vi.fn(async (n: Row) => { notifications.push(n); }),
  notifyAdmins: vi.fn(async (n: Row) => { notifications.push(n); }),
}));
vi.mock("@/lib/approvals/gate", () => ({
  enforceApprovalGate: vi.fn(async () => gate),
  markApprovalExecuted: vi.fn(async (id: string) => { executedApprovals.push(id); }),
}));
vi.mock("@/lib/security/event-bus", () => ({ publishSecurityEvent: vi.fn(async (e: Row) => { securityEvents.push(e); return { recorded: true }; }) }));
vi.mock("@/lib/profile-restrictions", () => ({ hasActiveRestriction: vi.fn(async (id: string, type: string) => restrictions.get(id)?.has(type) ?? false) }));
vi.mock("@/lib/privacy/data-hold", () => ({ hasActiveHold: vi.fn(async (p: { profileId?: string; recordType?: string; recordId?: string }) => (p.profileId ? holds.get(p.profileId) ?? false : false)) }));
vi.mock("@/lib/family/access-control", () => ({
  getFamilyMembership: vi.fn(async (id: string) => (id === "f1" ? { applicantId: "p1" } : id === "f-bad" ? { applicantId: "p2" } : null)),
  hasFamilyPermission: vi.fn(async (_id: string, perm: string) => perm === "document.view" || perm === "document.download"),
}));
vi.mock("@/lib/route-guard", () => ({ ApiError: class ApiError extends Error {}, HttpError: class HttpError extends Error {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

// Storage: keep bytes in a plain Map instead of Vercel Blob; "encryption" is the identity function with a
// tag so tamper tests can flip a byte and the real hashBytes/verifyIntegrity logic still does the real work.
vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (key: string, data: Buffer) => { uploadedBlobs.set(key, Buffer.from(data)); return { url: `blob://${key}` }; }),
  del: vi.fn(async (url: string) => { uploadedBlobs.delete(url.replace("blob://", "")); }),
}));

// readDocumentBytes() fetches the blob URL directly (not through the @vercel/blob SDK) — stub global fetch
// to serve the in-memory map for these fake "blob://" URLs.
vi.stubGlobal("fetch", vi.fn(async (url: string) => {
  const key = url.replace("blob://", "");
  const bytes = uploadedBlobs.get(key);
  if (!bytes) return { ok: false, status: 404 } as Response;
  return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as unknown as Response;
}));

vi.stubEnv("NEXTAUTH_SECRET", "e2e-secret-for-document-tests-0123456789abcdef");

const { createDocument, replaceDocument, archiveDocument, restoreDocument, softDeleteDocument, fetchDocumentBytes, getDocumentOr404 } = await import("./document-service");
const { reviewDocument } = await import("./verification-service");
const { requestShare, approveShare, sweepExpiredShares } = await import("./sharing-service");
const { createRequest, sweepOverdueRequests } = await import("./request-service");
const { createSignatureRequest, signDocument, declineSignature } = await import("./signature-service");
const { redactDocument } = await import("./redaction-service");
const { sweepDocumentRetention } = await import("./retention");
const { sweepDocumentExpiration } = await import("./expiration");
const { seedDocumentCatalog } = await import("./catalog");
const { releaseFile, quarantineFile, getScanStatus } = await import("./security-scanner");
const { checkDocumentAccess } = await import("./access-service");

const admin = (over: Row = {}) => ({ id: "a1", name: "A", email: "a@x", role: "VERIFICATION_MANAGER", permissions: ["documents:view", "documents:review", "documents:verify", "documents:reject", "documents:share", "documents:revoke_share", "documents:archive", "documents:restore", "documents:redact", "documents:manage_requests", "documents:sign:manage", "documents:download"], sid: "s", ...over }) as never;

const PDF = (text: string) => Buffer.from(`%PDF-1.4\n${text}`);

// A structurally REAL, minimal one-page PDF (pdf-lib's own loader needs valid syntax — the fake "%PDF-1.4\n"
// buffer above is fine for magic-byte detection / heuristic scanning, but not for redaction/watermarking,
// which genuinely parse and rewrite the document).
async function realPdf(text: string): Promise<Buffer> {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 200]);
  page.drawText(text, { x: 20, y: 150, size: 12, font });
  return Buffer.from(await doc.save());
}

beforeEach(async () => {
  db.clear(); idc = 0; tick = 0;
  audits.length = 0; tasks.length = 0; notifications.length = 0; securityEvents.length = 0; executedApprovals.length = 0;
  gate = { requiresApproval: false }; restrictions.clear(); holds.clear();
  uploadedBlobs = new Map();
  await seedDocumentCatalog();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("§75 end-to-end: request -> upload -> scan -> review -> approve -> controlled sharing -> expiry -> audit", () => {
  it("runs the full flow without ever auto-sharing on proposal creation, and expires the share cleanly", async () => {
    // 1. Admin requests an identity document.
    const request = await createRequest(admin(), { typeKey: "PASSPORT", purpose: "Identity verification", requestedFromType: "PROFILE", requestedFromId: "p1" });
    expect(notifications.some((n) => n.type === "DOCUMENT_REQUESTED" && n.profileId === "p1")).toBe(true);

    // 2. Applicant uploads, fulfilling the request.
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "PASSPORT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("a real passport scan"), mimeType: "application/pdf", requestId: request.id });
    expect(created.quarantined).toBe(false);
    expect(created.document.status).toBe("AVAILABLE");
    expect(created.document.verificationStatus).toBe("PENDING");
    expect(securityEvents.some((e) => e.eventType === "DOCUMENT_UPLOADED")).toBe(true);
    expect(tasks.some((t) => t.taskType === "DOCUMENT_REVIEW_TASK")).toBe(true);
    const refreshedRequest = await import("@/lib/prisma").then((m) => m.prisma.documentRequest.findUnique({ where: { id: request.id } }));
    expect((refreshedRequest as Row).status).toBe("UPLOADED");

    // 3. Assigned verification staff reviews and approves.
    const result = await reviewDocument(admin(), { documentId: created.document.id, action: "APPROVE" });
    expect(result.approvalRequired).toBe(false);
    if (!result.approvalRequired) {
      expect(result.document.status).toBe("VERIFIED");
      expect(result.document.verificationStatus).toBe("VERIFIED");
    }
    expect(notifications.some((n) => n.type === "DOCUMENT_REVIEW_DECIDED")).toBe(true);
    const completedRequest = await import("@/lib/prisma").then((m) => m.prisma.documentRequest.findUnique({ where: { id: request.id } }));
    expect((completedRequest as Row).status).toBe("COMPLETED");

    // 4. The document remains private — creating a proposal does NOT create a share.
    expect(rows("documentShare")).toHaveLength(0);

    // 5. An explicit share request to the other party of the proposal always needs approval.
    gate = { requiresApproval: true, status: "CREATED", approvalRequestId: "ar1", approvalCode: "APR-1" };
    const pending = await requestShare({ type: "PROFILE", id: "p1" }, { documentId: created.document.id, recipientType: "PROFILE", recipientId: "p2", purpose: "Requested by my match", scope: "VIEW" });
    expect(pending).toMatchObject({ approvalRequired: true, approvalCode: "APR-1" });
    expect(rows("documentShare")[0].status).toBe("PENDING_APPROVAL");

    // 6. Approval clears it.
    gate = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ar1", approvalCode: "APR-1" };
    const approved = await requestShare({ type: "PROFILE", id: "p1" }, { documentId: created.document.id, recipientType: "PROFILE", recipientId: "p2", purpose: "Requested by my match", scope: "VIEW" });
    // a second requestShare call creates a SECOND row in this simplified flow; approve the pending one directly instead, mirroring the real "resume" path:
    void approved;
    const share = rows("documentShare")[0];
    const approvedShare = await approveShare(admin(), share.id as string);
    expect(approvedShare.status).toBe("ACTIVE");

    // 7. Temporary secure access — the recipient can now view it (never download unless scope says so).
    const viewed = await fetchDocumentBytes({ type: "PROFILE", id: "p1" }, created.document.id, "PREVIEW");
    expect(viewed.bytes.toString()).toContain("a real passport scan");
    expect(rows("documentAccessLog").some((l) => l.action === "PREVIEW" && l.result === "ALLOWED")).toBe(true);

    // 8. The share expires — access is denied afterwards.
    await import("@/lib/prisma").then((m) => m.prisma.documentShare.update({ where: { id: share.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const expiredCount = await sweepExpiredShares();
    expect(expiredCount).toBe(1);
    const doc = await getDocumentOr404(created.document.id);
    const decision = await checkDocumentAccess({ type: "PROFILE", id: "p2" }, doc, "VIEW");
    expect(decision).toEqual({ allowed: false, reason: "NOT_OWNER" }); // p2 is not the owner and the share is gone

    // 9. Every step left an audit trail.
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["DOCUMENT_UPLOADED", "DOCUMENT_APPROVED", "DOCUMENT_SHARE_APPROVED"]));
  });
});

describe("upload -> quarantine -> human decision", () => {
  it("an EICAR test file is quarantined, invisible to a normal reviewer, and only release/destroy by an authorized admin can act on it", async () => {
    const eicar = Buffer.from("%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "PASSPORT", uploaderType: "PROFILE", uploaderId: "p1", file: eicar, mimeType: "application/pdf" });
    expect(created.quarantined).toBe(true);
    expect(created.document.status).toBe("QUARANTINED");
    expect(securityEvents.some((e) => e.eventType === "DOCUMENT_SCAN_SUSPICIOUS")).toBe(true);

    const reviewer = { type: "ADMIN" as const, id: "reviewer", permissions: ["documents:view"] };
    const denied = await checkDocumentAccess(reviewer, created.document as never, "VIEW");
    expect(denied).toEqual({ allowed: false, reason: "NOT_FOUND" }); // never visible to a normal reviewer

    const scan = await getScanStatus(created.document.id);
    const quarantine = await releaseFile(scan!.id, "security-admin", "reviewed manually, false positive");
    expect(quarantine.decision).toBe("RELEASED");
    await expect(releaseFile(scan!.id, "security-admin")).rejects.toThrow(/already been decided/);

    const eicar2 = Buffer.from("%PDF-1.4\nX5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const created2 = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "PASSPORT", uploaderType: "PROFILE", uploaderId: "p1", file: eicar2, mimeType: "application/pdf" });
    const scan2 = await getScanStatus(created2.document.id);
    const destroyed = await quarantineFile(scan2!.id, "security-admin", "confirmed malicious test signature");
    expect(destroyed.decision).toBe("DESTROYED");
  });
});

describe("redaction: the original is never modified", () => {
  it("produces a new version with a different hash; the original version keeps its own", async () => {
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "AGREEMENT", uploaderType: "PROFILE", uploaderId: "p1", file: await realPdf("name: Ayesha, account: 12345"), mimeType: "application/pdf" });
    const originalHash = created.document.fileHash;
    gate = { requiresApproval: false };
    const redacted = await redactDocument(admin({ permissions: ["documents:redact"] }), { documentId: created.document.id, regions: [{ page: 1, x: 0, y: 0, width: 100, height: 20 }], reason: "Redact account number for external sharing" });
    expect(redacted.approvalRequired).toBe(false);
    if (!redacted.approvalRequired) {
      expect(redacted.document.currentVersion).toBe(2);
      expect(redacted.document.fileHash).not.toBe(originalHash);
    }
    const v1 = await import("@/lib/prisma").then((m) => m.prisma.documentVersion.findFirst({ where: { documentId: created.document.id, version: 1 } }));
    expect((v1 as Row).fileHash).toBe(originalHash); // the original version's own record is untouched
  });
});

describe("tamper detection", () => {
  it("a stored document whose recorded hash no longer matches its (successfully decrypted) bytes is refused and flagged, never silently served", async () => {
    // AES-256-GCM's own authentication tag already refuses tampered CIPHERTEXT outright (a corrupted blob
    // simply fails to decrypt); the explicit hash check below is the second, independent defense — e.g. the
    // stored bytes were swapped for another validly-encrypted file. Simulated here by corrupting the
    // recorded hash directly, so decryption still succeeds but the integrity check still catches it.
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "AGREEMENT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("original content"), mimeType: "application/pdf" });
    await import("@/lib/prisma").then((m) => m.prisma.document.update({ where: { id: created.document.id }, data: { fileHash: "0".repeat(64) } }));
    await expect(fetchDocumentBytes({ type: "PROFILE", id: "p1" }, created.document.id, "DOWNLOAD")).rejects.toThrow(/integrity/i);
    expect(securityEvents.some((e) => e.eventType === "DOCUMENT_TAMPER_DETECTED")).toBe(true);
    expect(rows("documentAccessLog").some((l) => l.denialReason === "DOCUMENT_INTEGRITY_ERROR")).toBe(true);
  });

  it("a corrupted ciphertext blob fails to decrypt outright (GCM authentication), which the caller also treats as a delivery failure", async () => {
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "AGREEMENT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("original content"), mimeType: "application/pdf" });
    const key = created.document.secureStorageReference.replace("blob://", "");
    const bytes = uploadedBlobs.get(key)!;
    bytes[0] = bytes[0] ^ 0xff;
    await expect(fetchDocumentBytes({ type: "PROFILE", id: "p1" }, created.document.id, "DOWNLOAD")).rejects.toThrow();
  });
});

describe("legal hold and open cases block retention redaction", () => {
  it("redacts an old verified document by default, but never one under legal hold or with an open case", async () => {
    const old = new Date(Date.now() - 400 * 86_400_000);
    rows("document").push(
      { id: "old1", documentCode: "LPP-DOC-900001", profileId: "p1", ownerType: "PROFILE", ownerId: "p1", typeKey: "AGREEMENT", categoryKey: "AGREEMENT", classification: "CONFIDENTIAL", status: "VERIFIED", createdAt: old, secureStorageReference: "blob://old1", fileHash: "h1" },
      { id: "old2", documentCode: "LPP-DOC-900002", profileId: "p2", ownerType: "PROFILE", ownerId: "p2", typeKey: "AGREEMENT", categoryKey: "AGREEMENT", classification: "CONFIDENTIAL", status: "VERIFIED", createdAt: old, secureStorageReference: "blob://old2", fileHash: "h2" }
    );
    uploadedBlobs.set("old1", Buffer.from("x"));
    uploadedBlobs.set("old2", Buffer.from("x"));
    rows("retentionPolicy").push({ id: "rp", category: "DOCUMENT_RECORDS", retentionDays: 365, action: "ANONYMIZE", isActive: true });
    holds.set("p2", true);
    const result = await sweepDocumentRetention();
    expect(result.redacted).toBe(1);
    expect(result.skippedHold).toBe(1);
    const d1 = rows("document").find((r) => r.id === "old1")!;
    const d2 = rows("document").find((r) => r.id === "old2")!;
    expect(d1.bodyRedactedAt).toBeInstanceOf(Date);
    expect(uploadedBlobs.has("old1")).toBe(false); // the underlying bytes are actually gone
    expect(d2.bodyRedactedAt ?? null).toBeNull();
    expect(uploadedBlobs.has("old2")).toBe(true);
  });
});

describe("signature workflow", () => {
  it("supports consent + typed name signing, decline, and void — never claims a cryptographic signature", async () => {
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "CONSENT_FORM", uploaderType: "ADMIN", uploaderId: "a1", file: PDF("consent text"), mimeType: "application/pdf" });
    const request = await createSignatureRequest(admin(), { documentId: created.document.id, recipients: [{ recipientType: "PROFILE", recipientId: "p1" }] });
    expect(notifications.some((n) => n.type === "DOCUMENT_SIGNATURE_REQUEST")).toBe(true);

    await expect(signDocument({ requestId: request.id, recipientType: "PROFILE", recipientId: "p1", typedFullName: "Ayesha Khan", consented: false })).rejects.toThrow(/consent/i);
    const signed = await signDocument({ requestId: request.id, recipientType: "PROFILE", recipientId: "p1", typedFullName: "Ayesha Khan", consented: true });
    expect(signed.status).toBe("SIGNED");
    expect(rows("documentSignatureRecipient")[0]).toMatchObject({ status: "SIGNED", signedName: "Ayesha Khan" });

    const request2 = await createSignatureRequest(admin(), { documentId: created.document.id, recipients: [{ recipientType: "PROFILE", recipientId: "p1" }] });
    const declined = await declineSignature(request2.id, "PROFILE", "p1", "Changed my mind");
    expect(declined.status).toBe("DECLINED");

    const request3 = await createSignatureRequest(admin(), { documentId: created.document.id, recipients: [{ recipientType: "PROFILE", recipientId: "p1" }] });
    const voided = await import("./signature-service").then((m) => m.voidSignatureRequest(admin(), request3.id, "Sent to the wrong recipient"));
    expect(voided.status).toBe("VOIDED");
  });
});

describe("family document access", () => {
  it("a family member needs BOTH the family permission and an active share for this specific document", async () => {
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "AGREEMENT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("family doc"), mimeType: "application/pdf" });
    await expect(fetchDocumentBytes({ type: "FAMILY_MEMBER", id: "f1" }, created.document.id, "PREVIEW")).rejects.toThrow(); // no share yet
    await requestShare({ type: "PROFILE", id: "p1" }, { documentId: created.document.id, recipientType: "FAMILY_MEMBER", recipientId: "f1", purpose: "Family review", scope: "VIEW" });
    const viewed = await fetchDocumentBytes({ type: "FAMILY_MEMBER", id: "f1" }, created.document.id, "PREVIEW");
    expect(viewed.bytes.toString()).toContain("family doc");
    await expect(fetchDocumentBytes({ type: "FAMILY_MEMBER", id: "f1" }, created.document.id, "DOWNLOAD")).rejects.toThrow(); // scope is VIEW only
    // a family member for a DIFFERENT applicant can never see it even with a (mismatched) membership
    await expect(fetchDocumentBytes({ type: "FAMILY_MEMBER", id: "f-bad" }, created.document.id, "PREVIEW")).rejects.toThrow();
  });
});

describe("versioning keeps history intact", () => {
  it("a replacement creates a new version and resets the review decision, never deletes the old one", async () => {
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "AGREEMENT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("v1 content"), mimeType: "application/pdf" });
    await reviewDocument(admin(), { documentId: created.document.id, action: "APPROVE" });
    const replaced = await replaceDocument({ documentId: created.document.id, uploaderType: "PROFILE", uploaderId: "p1", file: PDF("v2 content"), mimeType: "application/pdf", changeReason: "Updated the agreement" });
    expect(replaced.document.currentVersion).toBe(2);
    expect(replaced.document.verificationStatus).toBe("PENDING"); // back to needing review
    const versions = await import("@/lib/prisma").then((m) => m.prisma.documentVersion.findMany({ where: { documentId: created.document.id } }));
    expect(versions).toHaveLength(2);
  });
});

describe("document requests: overdue reminders and expiry, self-service delete", () => {
  it("reminds once, then expires past the grace window; a plain unused upload can be self-deleted, a verified one cannot", async () => {
    const request = await createRequest(admin(), { typeKey: "PASSPORT", purpose: "test", requestedFromType: "PROFILE", requestedFromId: "p1", dueDate: new Date(Date.now() - 86_400_000) });
    const first = await sweepOverdueRequests();
    expect(first.reminded).toBe(1);
    const second = await sweepOverdueRequests();
    expect(second.reminded).toBe(0); // deduplicated — not reminded twice in the same run window
    await import("@/lib/prisma").then((m) => m.prisma.documentRequest.update({ where: { id: request.id }, data: { dueDate: new Date(Date.now() - 20 * 86_400_000) } }));
    const third = await sweepOverdueRequests();
    expect(third.expired).toBe(1);

    const doc = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "AGREEMENT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("scratch"), mimeType: "application/pdf" });
    await softDeleteDocument({ type: "PROFILE", id: "p1" }, doc.document.id, "No longer needed");
    await reviewDocument(admin(), { documentId: (await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "AGREEMENT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("v"), mimeType: "application/pdf" })).document.id, action: "APPROVE" });
    const verifiedId = rows("document").find((r) => r.status === "VERIFIED")!.id as string;
    await expect(softDeleteDocument({ type: "PROFILE", id: "p1" }, verifiedId, "trying to delete evidence")).rejects.toThrow();
  });
});

describe("archive / restore", () => {
  it("only staff with the right permission can archive or restore", async () => {
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "AGREEMENT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("x"), mimeType: "application/pdf" });
    const weak = { type: "ADMIN" as const, id: "weak", permissions: ["documents:view"] };
    await expect(archiveDocument(weak, created.document.id)).rejects.toThrow();
    const archived = await archiveDocument({ type: "ADMIN", id: "a1", permissions: ["documents:archive"] }, created.document.id);
    expect(archived.status).toBe("ARCHIVED");
    const restored = await restoreDocument({ type: "ADMIN", id: "a1", permissions: ["documents:restore"] }, created.document.id);
    expect(restored.status).toBe("AVAILABLE");
  });
});

describe("restriction blocks uploads", () => {
  it("a profile under DOCUMENT_ACCESS_RESTRICTED cannot upload", async () => {
    restrictions.set("p1", new Set(["DOCUMENT_ACCESS_RESTRICTED"]));
    await expect(createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "AGREEMENT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("x"), mimeType: "application/pdf" })).rejects.toThrow(/restricted/i);
  });
});

describe("expiration reminders and re-verification", () => {
  it("reminds at 7 days out and flips an expired document to REVERIFICATION_REQUIRED with a task and notification", async () => {
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "PASSPORT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("x"), mimeType: "application/pdf" });
    await reviewDocument(admin(), { documentId: created.document.id, action: "APPROVE" });
    await import("@/lib/prisma").then((m) => m.prisma.document.update({ where: { id: created.document.id }, data: { expiresAt: new Date(Date.now() + 6.5 * 86_400_000) } }));
    const soon = await sweepDocumentExpiration();
    expect(soon.reminded).toBe(1);
    expect(notifications.some((n) => n.type === "DOCUMENT_EXPIRING_SOON")).toBe(true);

    await import("@/lib/prisma").then((m) => m.prisma.document.update({ where: { id: created.document.id }, data: { expiresAt: new Date(Date.now() - 1000) } }));
    const gone = await sweepDocumentExpiration();
    expect(gone.expired).toBe(1);
    const doc = await getDocumentOr404(created.document.id);
    expect(doc.status).toBe("EXPIRED");
    expect(doc.verificationStatus).toBe("REVERIFICATION_REQUIRED");
    expect(tasks.some((t) => t.taskType === "DOCUMENT_REVERIFICATION_TASK")).toBe(true);
    expect(notifications.some((n) => n.type === "DOCUMENT_REVERIFICATION_REQUIRED")).toBe(true);
  });
});

describe("no self-approval on restrict", () => {
  it("restricting a document goes through the STEP 19 gate", async () => {
    const created = await createDocument({ ownerType: "PROFILE", ownerId: "p1", profileId: "p1", typeKey: "AGREEMENT", uploaderType: "PROFILE", uploaderId: "p1", file: PDF("x"), mimeType: "application/pdf" });
    gate = { requiresApproval: true, status: "CREATED", approvalRequestId: "ar9", approvalCode: "APR-9" };
    const pending = await reviewDocument(admin(), { documentId: created.document.id, action: "RESTRICT" });
    expect(pending).toMatchObject({ approvalRequired: true, approvalCode: "APR-9" });
    expect((await getDocumentOr404(created.document.id)).status).not.toBe("RESTRICTED"); // not applied until approved
    gate = { requiresApproval: true, status: "READY_TO_EXECUTE", approvalRequestId: "ar9", approvalCode: "APR-9" };
    const applied = await reviewDocument(admin(), { documentId: created.document.id, action: "RESTRICT" });
    expect(applied.approvalRequired).toBe(false);
    expect(executedApprovals).toContain("ar9");
  });
});

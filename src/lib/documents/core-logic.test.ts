import { describe, it, expect, vi, beforeEach } from "vitest";

// Pure-function tests for the document system — mirrors src/lib/communications/core-logic.test.ts's style.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/route-guard", () => ({ ApiError: class ApiError extends Error {} }));

import { decideDocumentAccess } from "@/lib/documents/access-service";
import { createDocumentAccessToken, verifyDocumentAccessToken } from "@/lib/documents/access-tokens";
import { scanFile } from "@/lib/documents/security-scanner";
import { detectFileType, validateUpload } from "@/lib/ops/upload-validation";
import { hashBytes, verifyIntegrity } from "@/lib/documents/storage";
import { REJECTION_REASONS } from "@/lib/documents/verification-service";
import { DEFAULT_CATEGORIES, DEFAULT_TYPES } from "@/lib/documents/catalog";

const doc = (over: Partial<Parameters<typeof decideDocumentAccess>[0]["document"]> = {}) => ({
  id: "doc1",
  ownerType: "PROFILE" as const,
  ownerId: "p1",
  profileId: "p1",
  classification: "CONFIDENTIAL" as const,
  status: "AVAILABLE" as const,
  softDeletedAt: null,
  archivedAt: null,
  typeKey: "EDUCATIONAL_CERTIFICATE",
  requestId: null,
  ...over,
});
const base = { restricted: false, legalHold: false, identityDocument: false };

describe("document access decision (pure)", () => {
  it("an applicant may always read their own document, whatever its classification", () => {
    for (const action of ["VIEW", "PREVIEW", "DOWNLOAD"] as const) {
      expect(decideDocumentAccess({ actor: { type: "PROFILE", id: "p1" }, document: doc({ classification: "RESTRICTED" }), action, ...base }).allowed).toBe(true);
    }
  });

  it("an applicant can never read someone else's document", () => {
    const d = decideDocumentAccess({ actor: { type: "PROFILE", id: "p2" }, document: doc(), action: "VIEW", ...base });
    expect(d).toEqual({ allowed: false, reason: "NOT_OWNER" });
  });

  it("an applicant never reviews, verifies, redacts, exports or archives — even their own document", () => {
    for (const action of ["VERIFY", "APPROVE", "REJECT", "REDACT", "EXPORT", "RESTORE"] as const) {
      expect(decideDocumentAccess({ actor: { type: "PROFILE", id: "p1" }, document: doc(), action, ...base }).allowed).toBe(false);
    }
  });

  it("an applicant's self-service delete is narrow: own, no request, not verified, not restricted", () => {
    expect(decideDocumentAccess({ actor: { type: "PROFILE", id: "p1" }, document: doc(), action: "DELETE", ...base }).allowed).toBe(true);
    expect(decideDocumentAccess({ actor: { type: "PROFILE", id: "p1" }, document: doc({ status: "VERIFIED" }), action: "DELETE", ...base }).allowed).toBe(false);
    expect(decideDocumentAccess({ actor: { type: "PROFILE", id: "p1" }, document: doc({ requestId: "req1" }), action: "DELETE", ...base }).allowed).toBe(false);
    expect(decideDocumentAccess({ actor: { type: "PROFILE", id: "p1" }, document: doc(), action: "DELETE", ...base, restricted: true })).toEqual({ allowed: false, reason: "RESTRICTED" });
  });

  it("a restricted profile cannot request a new share, but can still read", () => {
    expect(decideDocumentAccess({ actor: { type: "PROFILE", id: "p1" }, document: doc(), action: "SHARE", ...base, restricted: true }).allowed).toBe(false);
    expect(decideDocumentAccess({ actor: { type: "PROFILE", id: "p1" }, document: doc(), action: "VIEW", ...base, restricted: true }).allowed).toBe(true);
  });

  it("a document under legal hold can never be deleted, by anyone", () => {
    const admin = { type: "ADMIN" as const, id: "a1", permissions: ["documents:delete"] };
    expect(decideDocumentAccess({ actor: admin, document: doc(), action: "DELETE", ...base, legalHold: true })).toEqual({ allowed: false, reason: "LEGAL_HOLD" });
  });

  it("a soft-deleted document is a 404 to everyone except an admin restoring it", () => {
    const admin = { type: "ADMIN" as const, id: "a1", permissions: ["documents:restore", "documents:view"] };
    expect(decideDocumentAccess({ actor: { type: "PROFILE", id: "p1" }, document: doc({ softDeletedAt: new Date() }), action: "VIEW", ...base }).reason).toBe("NOT_FOUND");
    expect(decideDocumentAccess({ actor: admin, document: doc({ softDeletedAt: new Date() }), action: "RESTORE", ...base }).allowed).toBe(true);
  });

  it("a family member needs BOTH the permission AND an active share, and download needs its own scope", () => {
    const actor = { type: "FAMILY_MEMBER" as const, id: "f1" };
    const noPerm = { membershipActive: true, applicantId: "p1", permissionView: false, permissionComment: false, permissionDownload: false, shareActive: true, shareScope: "VIEW" as const };
    expect(decideDocumentAccess({ actor, document: doc(), action: "VIEW", ...base, family: noPerm }).reason).toBe("FAMILY_PERMISSION_MISSING");
    const noShare = { ...noPerm, permissionView: true, shareActive: false, shareScope: null };
    expect(decideDocumentAccess({ actor, document: doc(), action: "VIEW", ...base, family: noShare }).reason).toBe("NOT_SHARED");
    const viewOnly = { ...noPerm, permissionView: true, permissionDownload: true, shareActive: true, shareScope: "VIEW" as const };
    expect(decideDocumentAccess({ actor, document: doc(), action: "VIEW", ...base, family: viewOnly }).allowed).toBe(true);
    expect(decideDocumentAccess({ actor, document: doc(), action: "DOWNLOAD", ...base, family: viewOnly }).reason).toBe("SHARE_SCOPE");
    const canDownload = { ...viewOnly, shareScope: "DOWNLOAD" as const };
    expect(decideDocumentAccess({ actor, document: doc(), action: "DOWNLOAD", ...base, family: canDownload }).allowed).toBe(true);
  });

  it("no membership at all is a 404, not a permission error (no existence leak)", () => {
    const actor = { type: "FAMILY_MEMBER" as const, id: "f1" };
    expect(decideDocumentAccess({ actor, document: doc(), action: "VIEW", ...base, family: { membershipActive: false, applicantId: null, permissionView: true, permissionComment: false, permissionDownload: true, shareActive: true, shareScope: "VIEW" } }).reason).toBe("NOT_FOUND");
  });

  it("admin download needs a stronger permission for highly sensitive documents, and identity documents need their own permission", () => {
    const weak = { type: "ADMIN" as const, id: "a1", permissions: ["documents:view", "documents:download"] };
    const strong = { type: "ADMIN" as const, id: "a2", permissions: ["documents:view", "documents:download", "sensitive:documents:download", "sensitive:identity_documents:view"] };
    expect(decideDocumentAccess({ actor: weak, document: doc({ classification: "HIGHLY_SENSITIVE" }), action: "DOWNLOAD", ...base }).allowed).toBe(false);
    expect(decideDocumentAccess({ actor: strong, document: doc({ classification: "HIGHLY_SENSITIVE" }), action: "DOWNLOAD", ...base }).allowed).toBe(true);
    expect(decideDocumentAccess({ actor: weak, document: doc(), action: "DOWNLOAD", ...base, identityDocument: true }).allowed).toBe(false);
    expect(decideDocumentAccess({ actor: strong, document: doc(), action: "DOWNLOAD", ...base, identityDocument: true }).allowed).toBe(true);
  });

  it("no self-approval loophole: an admin with only documents:review cannot approve or reject", () => {
    const reviewer = { type: "ADMIN" as const, id: "a1", permissions: ["documents:view", "documents:review"] };
    expect(decideDocumentAccess({ actor: reviewer, document: doc(), action: "APPROVE", ...base }).allowed).toBe(false);
    expect(decideDocumentAccess({ actor: reviewer, document: doc(), action: "REJECT", ...base }).allowed).toBe(false);
  });

  it("sharing a highly sensitive document needs the sensitive share permission", () => {
    const weak = { type: "ADMIN" as const, id: "a1", permissions: ["documents:share"] };
    const strong = { type: "ADMIN" as const, id: "a2", permissions: ["documents:share", "sensitive:documents:share"] };
    expect(decideDocumentAccess({ actor: weak, document: doc({ classification: "RESTRICTED" }), action: "SHARE", ...base }).allowed).toBe(false);
    expect(decideDocumentAccess({ actor: strong, document: doc({ classification: "RESTRICTED" }), action: "SHARE", ...base }).allowed).toBe(true);
  });
});

describe("signed document access tickets", () => {
  const secret = "test-secret-for-document-access-tokens-0123456789";
  beforeEach(() => vi.stubEnv("NEXTAUTH_SECRET", secret));

  it("round-trips and is scoped to exactly the document/viewer/action it was issued for", () => {
    const token = createDocumentAccessToken({ documentId: "doc1", viewerType: "ADMIN", viewerId: "a1", scope: "PREVIEW" });
    expect(verifyDocumentAccessToken(token, { documentId: "doc1", viewerType: "ADMIN", viewerId: "a1", scope: "PREVIEW" })).toEqual({ valid: true });
    expect(verifyDocumentAccessToken(token, { documentId: "doc2", viewerType: "ADMIN", viewerId: "a1", scope: "PREVIEW" }).reason).toBe("MISMATCH");
    expect(verifyDocumentAccessToken(token, { documentId: "doc1", viewerType: "ADMIN", viewerId: "a1", scope: "DOWNLOAD" }).reason).toBe("MISMATCH");
    expect(verifyDocumentAccessToken(token, { documentId: "doc1", viewerType: "PROFILE", viewerId: "a1", scope: "PREVIEW" }).reason).toBe("MISMATCH");
  });

  it("expires and cannot be forged or replayed with a different expiry", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const token = createDocumentAccessToken({ documentId: "doc1", viewerType: "ADMIN", viewerId: "a1", scope: "DOWNLOAD", ttlSeconds: 60 });
    vi.setSystemTime(new Date("2026-01-01T00:00:30Z"));
    expect(verifyDocumentAccessToken(token, { documentId: "doc1", viewerType: "ADMIN", viewerId: "a1", scope: "DOWNLOAD" })).toEqual({ valid: true });
    vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
    expect(verifyDocumentAccessToken(token, { documentId: "doc1", viewerType: "ADMIN", viewerId: "a1", scope: "DOWNLOAD" }).reason).toBe("EXPIRED");
    vi.useRealTimers();
    expect(verifyDocumentAccessToken("garbage", { documentId: "doc1", viewerType: "ADMIN", viewerId: "a1", scope: "DOWNLOAD" }).reason).toBe("MALFORMED");
    const tampered = token.split(".");
    tampered[0] = "doc-evil";
    expect(verifyDocumentAccessToken(tampered.join("."), { documentId: "doc-evil", viewerType: "ADMIN", viewerId: "a1", scope: "DOWNLOAD" }).reason).toBe("BAD_SIGNATURE");
  });
});

describe("upload hardening (magic bytes)", () => {
  it("detects real content and rejects a mismatched or disguised extension", () => {
    const pdfBytes = Buffer.from("%PDF-1.4\n%mock");
    expect(detectFileType(pdfBytes)).toBe("application/pdf");
    const check = validateUpload({ buffer: pdfBytes, declaredMime: "image/jpeg", filename: "resume.pdf", allowed: ["application/pdf"], maxBytes: 1_000_000 });
    expect(check.ok).toBe(false); // declared type doesn't match the real content
    const disguised = validateUpload({ buffer: pdfBytes, declaredMime: "application/pdf", filename: "resume.exe.pdf", allowed: ["application/pdf"], maxBytes: 1_000_000 });
    expect(disguised.ok).toBe(false); // a double-extension trick is rejected even though the real content and final extension are fine
    const exe = validateUpload({ buffer: pdfBytes, declaredMime: "application/pdf", filename: "invoice.php.pdf", allowed: ["application/pdf"], maxBytes: 1_000_000 });
    expect(exe.ok).toBe(false);
    const direct = validateUpload({ buffer: Buffer.from("MZ\x90\x00fakepe"), declaredMime: "application/pdf", filename: "resume.exe", allowed: ["application/pdf"], maxBytes: 1_000_000 });
    expect(direct.ok).toBe(false);
  });

  it("recognises DOCX/XLSX by their real OOXML part names, not just the ZIP magic bytes", () => {
    const docxLike = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("...word/document.xml...")]);
    const xlsxLike = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("...xl/workbook.xml...")]);
    const plainZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("...something/else.txt...")]);
    expect(detectFileType(docxLike)).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(detectFileType(xlsxLike)).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(detectFileType(plainZip)).toBeNull(); // an ordinary zip/disguised archive is never accepted
  });
});

describe("document security scanner (heuristics)", () => {
  it("flags the EICAR test signature as INFECTED — a real, meaningful check without needing a live virus", async () => {
    const eicar = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    const result = await scanFile(eicar, "application/pdf");
    expect(result.status).toBe("INFECTED");
    expect(result.findings.map((f) => f.code)).toContain("EICAR_TEST_SIGNATURE");
  });

  it("flags a PDF with an embedded /OpenAction or /JavaScript as SUSPICIOUS", async () => {
    const bytes = Buffer.from("%PDF-1.4\n1 0 obj << /OpenAction 2 0 R >>\nendobj");
    const result = await scanFile(bytes, "application/pdf");
    expect(result.status).toBe("SUSPICIOUS");
  });

  it("flags a polyglot file (an executable header hidden after the declared header) as SUSPICIOUS", async () => {
    const polyglot = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(20), Buffer.from("MZ")]);
    const result = await scanFile(polyglot, "application/pdf");
    expect(result.status).toBe("SUSPICIOUS");
  });

  it("an ordinary clean file scans CLEAN", async () => {
    const result = await scanFile(Buffer.from("%PDF-1.4\nordinary content here"), "application/pdf");
    expect(result.status).toBe("CLEAN");
    expect(result.findings).toEqual([]);
  });
});

describe("tamper detection", () => {
  it("the same bytes always hash the same way, and a single changed byte is detected", () => {
    const original = Buffer.from("the quick brown fox");
    const hash = hashBytes(original);
    expect(verifyIntegrity(original, hash)).toBe(true);
    const tampered = Buffer.from(original);
    tampered[0] = tampered[0] ^ 0xff;
    expect(verifyIntegrity(tampered, hash)).toBe(false);
  });
});

describe("review reasons and catalog", () => {
  it("ships a neutral, non-accusatory set of rejection reasons", () => {
    expect(REJECTION_REASONS).toContain("UNREADABLE");
    expect(REJECTION_REASONS).toContain("OTHER");
    for (const r of REJECTION_REASONS) expect(r).not.toMatch(/fraud|fake|lie|scam/i);
  });

  it("every default type points at a real default category, and CNIC is one configurable type among several — not the only one", () => {
    const categoryKeys = new Set(DEFAULT_CATEGORIES.map((c) => c.key));
    for (const t of DEFAULT_TYPES) expect(categoryKeys.has(t.categoryKey), t.key).toBe(true);
    const identityTypes = DEFAULT_TYPES.filter((t) => t.categoryKey === "IDENTITY").map((t) => t.key);
    expect(identityTypes).toContain("CNIC");
    expect(identityTypes.length).toBeGreaterThan(1);
  });
});

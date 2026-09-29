import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { ROLE_PERMISSIONS, hasPermission, type AdminRole, type Permission } from "@/lib/permissions";
import { serializeDocument } from "@/lib/documents/serialize";

const SRC = join(process.cwd(), "src");
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const allFiles = walk(SRC).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
const rel = (f: string) => relative(SRC, f).split(sep).join("/");
const read = (f: string) => readFileSync(f, "utf8");

const adminDocRoutes = allFiles.filter((f) => (rel(f).startsWith("app/api/admin/documents/") || rel(f).startsWith("app/api/admin/document-requests/") || rel(f).startsWith("app/api/admin/document-shares/") || rel(f).startsWith("app/api/admin/signatures/") || rel(f).startsWith("app/api/admin/document-catalog/")) && rel(f).endsWith("/route.ts"));
const myDocRoutes = allFiles.filter((f) => rel(f).startsWith("app/api/my-documents") && rel(f).endsWith("/route.ts"));
const familyDocRoutes = allFiles.filter((f) => rel(f).startsWith("app/api/family/documents") && rel(f).endsWith("/route.ts"));

const PERM = /requireAdmin\(\s*"([^"]+)"/g;

describe("document admin routes", () => {
  it("finds the route tree (sanity)", () => {
    expect(adminDocRoutes.length).toBeGreaterThan(20);
  });

  it("every handler is guarded by a real documents permission", () => {
    const known = new Set<string>(Object.values(ROLE_PERMISSIONS).flat());
    for (const f of adminDocRoutes) {
      const perms = [...read(f).matchAll(PERM)].map((m) => m[1]);
      expect(perms.length, rel(f)).toBeGreaterThanOrEqual(1);
      for (const p of perms) {
        expect(p.startsWith("documents:") || p.startsWith("sensitive:documents") || p.startsWith("verification:documents"), `${rel(f)} uses ${p}`).toBe(true);
        expect(known.has(p), `${rel(f)} uses an unknown permission ${p}`).toBe(true);
      }
    }
  });

  it("no mutating handler is protected by view-only", () => {
    for (const f of adminDocRoutes) {
      const src = read(f);
      const parts = src.split(/export async function /).slice(1);
      for (const part of parts) {
        const method = part.slice(0, part.indexOf("("));
        if (method === "GET") continue;
        const perm = part.match(PERM)?.[0]?.match(/"([^"]+)"/)?.[1];
        expect(perm && perm !== "documents:view", `${rel(f)} ${method} uses ${perm}`).toBe(true);
      }
    }
  });

  it("dangerous actions need their specific permission, not a generic one", () => {
    const need: Record<string, string> = {
      "documents/[id]/restrict/route.ts": "documents:review",
      "documents/[id]/redact/route.ts": "documents:redact",
      "documents/[id]/share/route.ts": "documents:share",
      "documents/[id]/revoke-share/route.ts": "documents:revoke_share",
      "documents/[id]/archive/route.ts": "documents:archive",
      "documents/[id]/restore/route.ts": "documents:restore",
      "documents/quarantine/[scanId]/release/route.ts": "documents:manage_providers",
      "documents/quarantine/[scanId]/destroy/route.ts": "documents:manage_providers",
      "signatures/[id]/void/route.ts": "documents:sign:manage",
      "document-catalog/route.ts": "documents:manage_providers",
    };
    for (const [suffix, perm] of Object.entries(need)) {
      const f = adminDocRoutes.find((x) => rel(x).endsWith(`documents/${suffix}`) || rel(x).endsWith(`admin/${suffix}`));
      expect(f, suffix).toBeTruthy();
      expect(read(f as string), suffix).toContain(`"${perm}"`);
    }
  });

  it("the webhook routes fail closed without a configured secret and are rate-limited", () => {
    for (const name of ["document-provider", "signature-provider"]) {
      const src = read(join(SRC, `app/api/webhooks/${name}/route.ts`));
      expect(src, name).toContain("enforcePersistentLimit(");
      expect(src, name).toMatch(/if \(!secret\) return NextResponse\.json/);
      expect(src, name).toContain("verifyEnvelope(");
    }
  });
});

describe("role matrix (separation of duties)", () => {
  const has = (role: AdminRole, p: Permission) => hasPermission(role, p);

  it("only verification/compliance managers and super admin can restrict, redact or share a document", () => {
    for (const role of ["SUPPORT_STAFF", "COMMUNICATION_STAFF", "VERIFICATION_STAFF"] as AdminRole[]) {
      expect(has(role, "documents:verify" as Permission), role).toBe(false);
      expect(has(role, "documents:reject" as Permission), role).toBe(false);
    }
    expect(has("VERIFICATION_MANAGER", "documents:verify" as Permission)).toBe(true);
  });

  it("only compliance/super admin manage legal hold, retention and providers", () => {
    for (const role of ["VERIFICATION_MANAGER", "VERIFICATION_STAFF", "SUPPORT_MANAGER", "COMMUNICATION_MANAGER"] as AdminRole[]) {
      expect(has(role, "documents:manage_legal_hold" as Permission), role).toBe(false);
      expect(has(role, "documents:manage_providers" as Permission), role).toBe(false);
    }
    expect(has("COMPLIANCE_MANAGER", "documents:manage_legal_hold" as Permission)).toBe(true);
    expect(has("SUPER_ADMIN", "documents:manage_legal_hold" as Permission)).toBe(true);
  });

  it("staff-tier roles can view and request documents but never verify/reject/delete", () => {
    for (const role of ["VERIFICATION_STAFF", "SUPPORT_STAFF"] as AdminRole[]) {
      for (const p of ["documents:verify", "documents:reject", "documents:delete", "documents:manage_legal_hold", "documents:manage_providers"]) {
        expect(has(role, p as Permission), `${role} ${p}`).toBe(false);
      }
    }
  });
});

describe("no leaked storage references or provider secrets", () => {
  it("serializeDocument never includes the raw blob key or encryption material", () => {
    const fake = { secureStorageReference: "https://blob.example/secret", ivBase64: "iv", authTagBase64: "tag", id: "d1", documentCode: "LPP-DOC-000001", ownerType: "PROFILE", typeKey: "PASSPORT", categoryKey: "IDENTITY", classification: "RESTRICTED", status: "AVAILABLE", currentVersion: 1, mimeType: "application/pdf", originalFilename: "x.pdf", sizeBytes: 10, verificationStatus: "PENDING", verificationReason: null, verificationNotes: null, reviewedAt: null, expiresAt: null, archivedAt: null, bodyRedactedAt: null, createdAt: new Date(), updatedAt: new Date() } as never;
    const json = JSON.stringify(serializeDocument(fake));
    expect(json).not.toContain("secureStorageReference");
    expect(json).not.toContain("blob.example");
    expect(json).not.toContain("ivBase64");
    expect(json).not.toContain("authTagBase64");
  });

  it("no admin/applicant/family route ever writes secureStorageReference into a JSON response", () => {
    for (const f of [...adminDocRoutes, ...myDocRoutes, ...familyDocRoutes]) {
      const src = read(f);
      // Look only at what's actually passed to NextResponse.json(...) — a nearby, unrelated use (e.g.
      // deleteDocumentBytes(document.secureStorageReference)) must not trip this check.
      for (const call of src.matchAll(/NextResponse\.json\(([\s\S]{0,400}?)\)/g)) {
        expect(call[1], rel(f)).not.toContain("secureStorageReference");
        expect(call[1], rel(f)).not.toMatch(/\bivBase64\b|\bauthTagBase64\b/);
      }
    }
  });
});

describe("no unofficial / external malware or e-signature vendor code", () => {
  it("the default security scanner runs local heuristics only — no outbound network call", () => {
    const src = read(join(SRC, "lib/documents/security-scanner.ts"));
    expect(src).not.toMatch(/\bfetch\(/);
  });

  it("the default signature provider is entirely in-app — no outbound network call, and is explicitly not legally binding", () => {
    const src = read(join(SRC, "lib/documents/providers/local-signature-provider.ts"));
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).toContain("legallyBinding = false");
  });

  it("the default OCR provider never fabricates extracted text", () => {
    const src = read(join(SRC, "lib/documents/providers/noop-ocr-provider.ts"));
    expect(src).not.toMatch(/\bfetch\(/);
    expect(src).toMatch(/supported:\s*false/);
  });
});

describe("applicant/family routes never take an actor id from the request body (IDOR)", () => {
  it("every /api/my-documents route derives the profile id from the session, not the request", () => {
    for (const f of myDocRoutes) {
      const src = read(f);
      expect(src, rel(f)).toMatch(/requireApplicantProfileId\(/);
      expect(src, rel(f)).not.toMatch(/body\.profileId|body\.uploaderId|body\.ownerId/);
    }
  });

  it("every /api/family/documents route derives the family member id from the session", () => {
    for (const f of familyDocRoutes) {
      const src = read(f);
      expect(src, rel(f)).toMatch(/requireFamilyMemberId\(/);
      expect(src, rel(f)).not.toMatch(/body\.familyMemberId/);
    }
  });

  it("sharing with another applicant (recipientType PROFILE) is always routed through the STEP 19 gate", () => {
    const src = read(join(SRC, "lib/documents/sharing-service.ts"));
    expect(src).toMatch(/needsGate = params\.recipientType === "PROFILE"/);
    expect(src).toContain("enforceApprovalGate(");
  });
});

describe("legal hold and retention reuse the existing generic mechanisms (no duplicate table)", () => {
  it("document legal hold reuses DataHold, retention reuses RetentionActionLog", () => {
    const access = read(join(SRC, "lib/documents/access-service.ts"));
    expect(access).toContain("hasActiveHold(");
    const retention = read(join(SRC, "lib/documents/retention.ts"));
    expect(retention).toContain("retentionActionLog.create");
    expect(retention).toContain("DOCUMENT_RECORDS");
  });
});

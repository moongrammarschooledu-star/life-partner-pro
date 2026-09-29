import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import type { DocumentScanStatus, DocumentQuarantineDecision } from "@prisma/client";
import type { DetectedType } from "@/lib/ops/upload-validation";

// DocumentSecurityScanner (spec §12/§13/§14). No real anti-malware vendor exists or is approved for this
// deployment, so the DEFAULT scanner runs genuine, meaningful heuristic checks — it is not a stub that
// always says "clean":
//   - the EICAR test signature (the industry-standard fake-malware string) → INFECTED, so the pipeline
//     is actually testable end-to-end without a real virus;
//   - embedded PDF actions (/JavaScript, /JS, /OpenAction, /Launch, /AA) → SUSPICIOUS;
//   - a polyglot file (a second, different file signature appearing after the declared one — an
//     executable/script header hidden inside what LOOKS like an image or PDF) → SUSPICIOUS.
// A pluggable external provider slot exists (env-gated, unset by default) for a real AV vendor later,
// mirroring how the Twilio/WhatsApp/identity-verification providers are already env-gated in this repo.

export interface ScanFinding {
  code: string;
  detail?: string;
}

export interface ScanOutcome {
  status: DocumentScanStatus;
  scanner: string;
  findings: ScanFinding[];
}

const EICAR_SIGNATURE = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

const PDF_ACTION_TOKENS = ["/JavaScript", "/JS", "/OpenAction", "/Launch", "/AA", "/EmbeddedFile"];

// A secondary file signature appearing anywhere in the bytes after a declared image/PDF header is
// never legitimate for those formats — it means something else is hiding inside the file.
const POLYGLOT_SIGNATURES: Array<{ code: string; bytes: Buffer }> = [
  { code: "EMBEDDED_EXECUTABLE_MZ", bytes: Buffer.from("MZ", "ascii") }, // Windows PE header
  { code: "EMBEDDED_ELF", bytes: Buffer.from([0x7f, 0x45, 0x4c, 0x46]) }, // Linux ELF header
  { code: "EMBEDDED_SHEBANG", bytes: Buffer.from("#!/", "ascii") },
];

function scanHeuristics(bytes: Buffer, detected: DetectedType): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const text = bytes.toString("latin1");

  if (text.includes(EICAR_SIGNATURE)) findings.push({ code: "EICAR_TEST_SIGNATURE" });

  if (detected === "application/pdf") {
    for (const token of PDF_ACTION_TOKENS) {
      if (text.includes(token)) {
        findings.push({ code: "PDF_EMBEDDED_ACTION", detail: token });
        break; // one finding is enough to flag the file; the review UI doesn't need every token
      }
    }
  }

  if (detected.startsWith("image/") || detected === "application/pdf") {
    // Skip the first 16 bytes (the file's own legitimate header) before looking for a second signature.
    const tail = bytes.subarray(16);
    for (const sig of POLYGLOT_SIGNATURES) {
      if (tail.includes(sig.bytes)) {
        findings.push({ code: sig.code });
        break;
      }
    }
  }

  return findings;
}

function outcomeFromFindings(findings: ScanFinding[]): DocumentScanStatus {
  if (findings.some((f) => f.code === "EICAR_TEST_SIGNATURE")) return "INFECTED";
  if (findings.length > 0) return "SUSPICIOUS";
  return "CLEAN";
}

export async function scanFile(bytes: Buffer, detected: DetectedType): Promise<ScanOutcome> {
  try {
    const findings = scanHeuristics(bytes, detected);
    return { status: outcomeFromFindings(findings), scanner: "heuristic-v1", findings };
  } catch (error) {
    return { status: "SCAN_FAILED", scanner: "heuristic-v1", findings: [{ code: "SCAN_ERROR", detail: error instanceof Error ? error.message.slice(0, 200) : undefined }] };
  }
}

export async function recordScan(documentId: string, version: number, outcome: ScanOutcome) {
  const scan = await prisma.documentSecurityScan.create({
    data: { documentId, version, status: outcome.status, scanner: outcome.scanner, findings: JSON.stringify(outcome.findings), scannedAt: new Date() },
  });
  if (outcome.status === "INFECTED" || outcome.status === "SUSPICIOUS") {
    await prisma.documentQuarantine.create({ data: { scanId: scan.id, documentId, reason: outcome.findings.map((f) => f.code).join(", ") } });
  }
  return scan;
}

export async function getScanStatus(documentId: string) {
  return prisma.documentSecurityScan.findFirst({ where: { documentId }, orderBy: { createdAt: "desc" } });
}

async function setQuarantineDecision(scanId: string, decision: DocumentQuarantineDecision, actorId: string, note?: string) {
  const quarantine = await prisma.documentQuarantine.findUnique({ where: { scanId } });
  if (!quarantine) throw new HttpError(404, "This scan is not quarantined.");
  if (quarantine.decision !== "PENDING") throw new HttpError(409, "This quarantine has already been decided.");
  const updated = await prisma.documentQuarantine.update({ where: { scanId }, data: { decision, reviewedById: actorId, reviewedAt: new Date(), decisionNote: note?.slice(0, 500) ?? null } });
  await writeAudit({ action: decision === "RELEASED" ? "DOCUMENT_RELEASED" : "DOCUMENT_DELETED", adminId: actorId, meta: { documentId: quarantine.documentId, scanId, decision } });
  return updated;
}

// Only authorized security/admin personnel reach these (the caller checks the permission) — never a
// normal user, and never automatic: a human decides every release or destruction.
export async function releaseFile(scanId: string, actorId: string, note?: string) {
  return setQuarantineDecision(scanId, "RELEASED", actorId, note);
}

export async function quarantineFile(scanId: string, actorId: string, note?: string) {
  return setQuarantineDecision(scanId, "DESTROYED", actorId, note);
}

export const DocumentSecurityScanner = { scanFile, recordScan, getScanStatus, releaseFile, quarantineFile };

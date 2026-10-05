import { prisma } from "@/lib/prisma";
import { HttpError } from "@/lib/http-error";
import { addSuppression, liftSuppression, HARD_REASONS } from "@/lib/communications/suppression-service";
import { marketingAudit } from "@/lib/marketing/audit";
import { computeContactHashes } from "@/lib/marketing/normalize";
import type { CommunicationSuppressionReason } from "@prisma/client";

// STEP 29 §27 — the marketing suppression list IS the STEP 25 CommunicationSuppression table (scope MARKETING/ALL,
// keyed by salted destination hash, works without a Profile). The spec's eight reasons map onto the existing enum:
//   user opted out → USER_REQUEST/UNSUBSCRIBED · communication restricted / internal business → ADMIN_RESTRICTION ·
//   safety restriction → SECURITY_RESTRICTION · legal restriction → JURISDICTION_RULE · complaint → COMPLAINT ·
//   invalid contact → BOUNCE · provider suppression → PROVIDER_BLOCK.

export const MARKETING_SUPPRESSION_REASONS: CommunicationSuppressionReason[] = [
  "USER_REQUEST", "UNSUBSCRIBED", "ADMIN_RESTRICTION", "SECURITY_RESTRICTION", "JURISDICTION_RULE", "COMPLAINT", "BOUNCE", "PROVIDER_BLOCK",
];

// True when ANY plausible hash of this contact has an active, unexpired ALL/MARKETING suppression.
export async function isContactSuppressed(hashes: string[], now = new Date()): Promise<boolean> {
  if (hashes.length === 0) return false;
  const hit = await prisma.communicationSuppression.findFirst({
    where: {
      destinationHash: { in: hashes },
      status: "ACTIVE",
      scope: { in: ["ALL", "MARKETING"] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  return !!hit;
}

export async function suppressContact(params: {
  phone?: string | null;
  email?: string | null;
  reason: CommunicationSuppressionReason;
  scope?: "ALL" | "MARKETING";
  note?: string | null;
  actorId?: string | null;
}): Promise<number> {
  if (!MARKETING_SUPPRESSION_REASONS.includes(params.reason)) throw new HttpError(422, "Unsupported suppression reason.");
  const h = computeContactHashes({ phone: params.phone, email: params.email });
  let created = 0;
  if (h.email) {
    await addSuppression({ channel: "EMAIL", reason: params.reason, scope: params.scope ?? "MARKETING", destination: h.email, note: params.note, actorId: params.actorId });
    created++;
  }
  if (h.phoneE164) {
    for (const channel of ["SMS", "WHATSAPP"] as const) {
      await addSuppression({ channel, reason: params.reason, scope: params.scope ?? "MARKETING", destination: h.phoneE164, note: params.note, actorId: params.actorId });
      created++;
    }
  }
  if (created === 0) throw new HttpError(422, "A valid phone number or email is required.");
  await marketingAudit({ action: "MARKETING_SUPPRESSION_CHANGED", actorId: params.actorId, resource: "suppression", resourceId: h.phoneHash ?? h.emailHash ?? "n/a", after: { reason: params.reason, scope: params.scope ?? "MARKETING", entries: created }, reason: params.note });
  return created;
}

// Lifting follows the STEP 25 rule: hard reasons (complaint, bounce, provider block, jurisdiction) need a longer
// written reason, enforced by the route via HARD_REASONS; the row is kept (status LIFTED), never deleted.
export async function liftMarketingSuppression(id: string, actorId: string, reason: string): Promise<void> {
  const row = await prisma.communicationSuppression.findUnique({ where: { id }, select: { reason: true } });
  if (!row) throw new HttpError(404, "Suppression not found.");
  if (HARD_REASONS.includes(row.reason) && reason.trim().length < 20) throw new HttpError(422, "Lifting this kind of suppression needs a written reason of at least 20 characters.");
  await liftSuppression(id, actorId, reason);
  await marketingAudit({ action: "MARKETING_SUPPRESSION_CHANGED", actorId, resource: "suppression", resourceId: id, after: { status: "LIFTED" }, reason });
}

import { prisma } from "@/lib/prisma";

// Generic row-per-key counter shared by LPP-DEL-######/LPP-PRIV-###### codes
// (STEP 13) and LPP-PAY-/LPP-SUB-/LPP-ORD-/LPP-INV-/LPP-DISC-/LPP-PKG-/
// LPP-REF- codes (STEP 14) — mirrors src/lib/case-code.ts's exact
// atomic-upsert pattern with a reusable key instead of many near-identical
// single-purpose tables.
export type SequencePrefix = "DEL" | "PRIV" | "PAY" | "SUB" | "ORD" | "INV" | "DISC" | "PKG" | "REF";

export async function nextSequenceCode(prefix: SequencePrefix): Promise<string> {
  const counter = await prisma.sequenceCounter.upsert({
    where: { key: prefix },
    update: { lastSeq: { increment: 1 } },
    create: { key: prefix, lastSeq: 1 },
  });
  return `LPP-${prefix}-${String(counter.lastSeq).padStart(6, "0")}`;
}

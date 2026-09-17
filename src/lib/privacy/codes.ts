import { prisma } from "@/lib/prisma";

// Generic row-per-key counter shared by LPP-DEL-###### and LPP-PRIV-######
// codes — mirrors src/lib/case-code.ts's exact atomic-upsert pattern with a
// reusable key instead of two near-identical single-purpose tables.
export async function nextSequenceCode(prefix: "DEL" | "PRIV"): Promise<string> {
  const counter = await prisma.sequenceCounter.upsert({
    where: { key: prefix },
    update: { lastSeq: { increment: 1 } },
    create: { key: prefix, lastSeq: 1 },
  });
  return `LPP-${prefix}-${String(counter.lastSeq).padStart(6, "0")}`;
}

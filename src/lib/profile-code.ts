import { prisma } from "@/lib/prisma";

// Human-readable display id only (spec §20). Never used for lookups/access
// control — all relations use the cuid primary key.
export async function nextProfileCode(): Promise<string> {
  const counter = await prisma.profileCodeCounter.upsert({
    where: { id: 1 },
    update: { lastSeq: { increment: 1 } },
    create: { id: 1, lastSeq: 1 },
  });
  return `LPP-${String(counter.lastSeq).padStart(6, "0")}`;
}

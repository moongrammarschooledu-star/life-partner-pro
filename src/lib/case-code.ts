import { prisma } from "@/lib/prisma";
import type { CaseType } from "@prisma/client";

// Human-readable display id, mirroring src/lib/proposal-code.ts's atomic
// per-key counter pattern. Prefix is chosen by case type (spec §3/§4/§6):
// SUPPORT -> LPP-SUP-, COMPLAINT -> LPP-CMP-, SAFETY_REPORT/INTERNAL -> LPP-CASE-.
function prefixFor(type: CaseType): "SUP" | "CMP" | "CASE" {
  if (type === "SUPPORT") return "SUP";
  if (type === "COMPLAINT") return "CMP";
  return "CASE";
}

export async function nextCaseNumber(type: CaseType): Promise<string> {
  const prefix = prefixFor(type);
  const counter = await prisma.caseCodeCounter.upsert({
    where: { prefix },
    update: { lastSeq: { increment: 1 } },
    create: { prefix, lastSeq: 1 },
  });
  return `LPP-${prefix}-${String(counter.lastSeq).padStart(6, "0")}`;
}

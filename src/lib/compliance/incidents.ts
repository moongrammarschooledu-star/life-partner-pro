import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { nextCaseNumber } from "@/lib/case-code";
import { computeSlaDueDates } from "@/lib/case-sla";
import type { CaseCategory, CasePriority } from "@prisma/client";

// Mirrors src/lib/ops/alerts.ts's openIncidentForAlert() line-for-line
// (plan decision 12) — compliance incidents reuse Case under
// CaseType.INTERNAL with the 8 new CaseCategory values, same precedent
// Payment Incidents already set (system-detected, ops-facing, no dedicated
// case-number prefix of its own; shares the LPP-CASE counter).

export interface CreateComplianceIncidentInput {
  category: CaseCategory;
  subject: string;
  description: string;
  priority?: CasePriority;
  actorId: string | null;
}

export async function createComplianceIncident(input: CreateComplianceIncidentInput): Promise<{ caseId: string; caseNumber: string }> {
  const priority = input.priority ?? "HIGH";
  const { firstResponseDueAt, resolutionDueAt } = await computeSlaDueDates(priority);

  const created = await prisma.case.create({
    data: {
      caseNumber: await nextCaseNumber("INTERNAL"),
      type: "INTERNAL",
      category: input.category,
      subject: input.subject,
      description: input.description,
      priority,
      createdById: input.actorId,
      firstResponseDueAt,
      resolutionDueAt,
    },
  });

  await writeAudit({ action: "COMPLIANCE_INCIDENT_CREATED", adminId: input.actorId, meta: { caseId: created.id, caseNumber: created.caseNumber, category: input.category } });
  return { caseId: created.id, caseNumber: created.caseNumber };
}

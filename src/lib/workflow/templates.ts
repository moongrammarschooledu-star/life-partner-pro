import { prisma } from "@/lib/prisma";
import type { CreateTaskParams } from "@/lib/workflow/engine";

// STEP 18 §26/§27 — applies a template's defaults (title/description/
// priority/checklist) as a base for a new task; any field the caller
// explicitly supplies still wins, so a template is a starting point, not an
// override.
export async function applyTemplate(templateId: string, draft: Partial<CreateTaskParams>): Promise<Partial<CreateTaskParams> & { checklist?: { label: string; required: boolean }[] }> {
  const template = await prisma.taskTemplate.findUnique({ where: { id: templateId } });
  if (!template || !template.active) return draft;

  return {
    taskType: draft.taskType ?? template.taskType,
    title: draft.title ?? template.titleTemplate,
    description: draft.description ?? template.descriptionTemplate ?? undefined,
    priority: draft.priority ?? template.defaultPriority,
    ...draft,
    checklist: (template.defaultChecklist as { label: string; required: boolean }[] | null) ?? undefined,
  };
}

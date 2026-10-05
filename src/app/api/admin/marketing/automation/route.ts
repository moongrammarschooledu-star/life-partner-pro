import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/route-guard";
import { AUTOMATION_TRIGGERS, createAutomationRule } from "@/lib/marketing/automation";
import { marketingError, noStore, readBody, str } from "@/lib/marketing/route-utils";

export async function GET() {
  try {
    await requireAdmin("marketing:automation:view");
    const [rules, runs] = await Promise.all([
      prisma.marketingAutomationRule.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.marketingAutomationRun.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, ruleId: true, ruleVersion: true, subjectType: true, status: true, error: true, createdAt: true } }),
    ]);
    return NextResponse.json({ triggers: AUTOMATION_TRIGGERS, rules, runs }, { headers: noStore });
  } catch (error) {
    return marketingError(error);
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin("marketing:automation:manage");
    const b = await readBody(req);
    const rule = await createAutomationRule(admin, { name: str(b, "name", { required: true, max: 120 }), trigger: str(b, "trigger", { required: true, max: 40 }), conditions: b.conditions, actions: b.actions });
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return marketingError(error);
  }
}

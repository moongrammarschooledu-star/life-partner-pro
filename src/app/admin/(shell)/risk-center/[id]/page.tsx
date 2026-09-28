import { requirePagePermission } from "@/lib/page-guard";
import { RiskCaseClient } from "@/components/admin/risk/risk-case-client";

export default async function RiskCasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("risk:view");
  const { id } = await params;
  return <RiskCaseClient caseId={id} permissions={user.permissions} />;
}

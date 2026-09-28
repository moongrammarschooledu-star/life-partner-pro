import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/page-guard";
import { RiskRulesClient } from "@/components/admin/risk/risk-rules-client";

// Either the rules or the configuration permission opens this screen; each section then checks its own.
export default async function RiskRulesPage() {
  const user = await requirePagePermission("risk:view");
  if (!user.permissions.includes("risk:rules:view") && !user.permissions.includes("risk:configuration:view")) redirect("/admin/risk-center");
  return <RiskRulesClient permissions={user.permissions} />;
}

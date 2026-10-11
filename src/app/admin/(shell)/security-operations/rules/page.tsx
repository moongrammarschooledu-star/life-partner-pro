import { requirePagePermission } from "@/lib/page-guard";
import { RulesClient } from "@/components/admin/soc/rules-client";

export default async function RulesPage() {
  const user = await requirePagePermission("soc:rules:view");
  return <RulesClient permissions={user.permissions} adminId={user.id} />;
}

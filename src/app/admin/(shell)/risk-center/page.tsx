import { requirePagePermission } from "@/lib/page-guard";
import { RiskCenterClient } from "@/components/admin/risk/risk-center-client";

// Admin -> Risk & Safety Center. A shell only: every API it calls enforces its own permission on the server, and
// the tabs shown here just mirror what the viewer may open.
export default async function RiskCenterPage() {
  const user = await requirePagePermission("risk:view");
  return <RiskCenterClient permissions={user.permissions} />;
}

import { requirePagePermission } from "@/lib/page-guard";
import { MarketingCenterClient } from "@/components/admin/marketing/marketing-center-client";

// Admin -> Marketing Center. A shell only: every API it calls enforces its own permission on the server.
export default async function MarketingPage() {
  const user = await requirePagePermission("marketing:view");
  return <MarketingCenterClient permissions={user.permissions} />;
}

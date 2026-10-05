import { requirePagePermission } from "@/lib/page-guard";
import { EngagementCenterClient } from "@/components/admin/engagement/engagement-center-client";

// Admin -> Engagement Center. A shell only: every API it calls enforces its own permission on the server.
export default async function EngagementPage() {
  const user = await requirePagePermission("engagement:view");
  return <EngagementCenterClient permissions={user.permissions} />;
}

import { requirePagePermission } from "@/lib/page-guard";
import { MarketingLeadClient } from "@/components/admin/marketing/lead-detail-client";

export default async function MarketingLeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("marketing:leads:view");
  const { id } = await params;
  return <MarketingLeadClient id={id} permissions={user.permissions} />;
}

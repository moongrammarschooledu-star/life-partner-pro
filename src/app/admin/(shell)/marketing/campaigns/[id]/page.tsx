import { requirePagePermission } from "@/lib/page-guard";
import { CampaignDetailClient } from "@/components/admin/marketing/campaign-detail-client";

export default async function MarketingCampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePagePermission("marketing:view");
  const [{ id }, { tab }] = await Promise.all([params, searchParams]);
  return <CampaignDetailClient id={id} permissions={user.permissions} initialTab={tab} />;
}

import { requirePagePermission } from "@/lib/page-guard";
import { RiskGraphClient } from "@/components/admin/risk/risk-graph-client";

export default async function RiskRelationshipsPage({ params }: { params: Promise<{ profileId: string }> }) {
  await requirePagePermission("relationships:view");
  const { profileId } = await params;
  return <RiskGraphClient profileId={profileId} />;
}

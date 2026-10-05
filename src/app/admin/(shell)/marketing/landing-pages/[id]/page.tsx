import { requirePagePermission } from "@/lib/page-guard";
import { LandingEditorClient } from "@/components/admin/marketing/landing-editor-client";

export default async function MarketingLandingEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("marketing:landing_pages:view");
  const { id } = await params;
  return <LandingEditorClient id={id} permissions={user.permissions} />;
}

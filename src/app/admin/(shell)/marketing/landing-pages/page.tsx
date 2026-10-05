import { requirePagePermission } from "@/lib/page-guard";
import { LandingPagesClient } from "@/components/admin/marketing/landing-pages-client";

export default async function MarketingLandingPagesPage() {
  const user = await requirePagePermission("marketing:landing_pages:view");
  return <LandingPagesClient permissions={user.permissions} />;
}

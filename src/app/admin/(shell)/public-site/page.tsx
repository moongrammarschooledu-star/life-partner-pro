import { requirePagePermission } from "@/lib/page-guard";
import { PublicSiteClient } from "@/components/admin/public-site/public-site-client";

export default async function PublicSitePage() {
  await requirePagePermission("marketing:analytics:view");
  return <PublicSiteClient />;
}

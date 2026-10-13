import { requirePagePermission } from "@/lib/page-guard";
import { FeaturesClient } from "@/components/admin/platform/features-client";

export default async function FeaturesPage() {
  const user = await requirePagePermission("platform:features:view");
  return <FeaturesClient permissions={user.permissions} />;
}
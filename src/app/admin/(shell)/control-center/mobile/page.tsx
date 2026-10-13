import { requirePagePermission } from "@/lib/page-guard";
import { MobileClient } from "@/components/admin/platform/mobile-client";

export default async function MobileAppsPage() {
  const user = await requirePagePermission("platform:mobile:view");
  return <MobileClient permissions={user.permissions} />;
}

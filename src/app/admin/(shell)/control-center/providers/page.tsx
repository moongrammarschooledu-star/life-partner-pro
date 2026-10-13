import { requirePagePermission } from "@/lib/page-guard";
import { ProvidersClient } from "@/components/admin/platform/providers-client";

export default async function ProvidersPage() {
  const user = await requirePagePermission("platform:providers:view");
  return <ProvidersClient permissions={user.permissions} />;
}
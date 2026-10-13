import { requirePagePermission } from "@/lib/page-guard";
import { SettingsClient } from "@/components/admin/platform/settings-client";

export default async function PlatformSettingsPage() {
  const user = await requirePagePermission("platform:settings:view");
  return <SettingsClient permissions={user.permissions} categories={["identity", "status"]} title="Platform settings" description="The platform's identity and the public status page. Each setting is typed and versioned, shows where it is used, and keeps its history." />;
}
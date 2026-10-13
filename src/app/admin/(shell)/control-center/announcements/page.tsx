import { requirePagePermission } from "@/lib/page-guard";
import { AnnouncementsClient } from "@/components/admin/platform/announcements-client";

export default async function AnnouncementsPage() {
  const user = await requirePagePermission("platform:announcements:view");
  return <AnnouncementsClient permissions={user.permissions} />;
}
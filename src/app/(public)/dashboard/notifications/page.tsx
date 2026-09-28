import { redirect } from "next/navigation";

// The notification center lives at /my-notifications (with its settings at /my-notifications/preferences); this is the
// dashboard-relative address for it.
export default function DashboardNotificationsPage() {
  redirect("/my-notifications");
}

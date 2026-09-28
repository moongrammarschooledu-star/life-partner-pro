import { requirePagePermission } from "@/lib/page-guard";
import { CommunicationsClient } from "@/components/admin/communications/communications-client";
import { testModeWarning } from "@/lib/communications/environment";

// Admin -> Communications. A shell only: every API it calls enforces its own permission on the server.
export default async function CommunicationsPage() {
  const user = await requirePagePermission("communications:view");
  return <CommunicationsClient permissions={user.permissions} testModeWarning={testModeWarning()} />;
}

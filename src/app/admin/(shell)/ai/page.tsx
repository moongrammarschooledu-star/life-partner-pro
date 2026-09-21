import { requirePagePermission } from "@/lib/page-guard";
import { AiAssistantClient } from "@/components/admin/ai/ai-assistant-client";

// Admin → AI Matchmaking Assistant. The page is only a shell: every feature it
// calls goes through /api/admin/ai/*, which enforces permission, rollout phase,
// consent and audit on the server.
export default async function AiAssistantPage() {
  const user = await requirePagePermission("ai:view");
  return <AiAssistantClient permissions={user.permissions} />;
}

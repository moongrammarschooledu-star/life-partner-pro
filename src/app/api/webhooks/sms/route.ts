import { enforcePersistentLimit } from "@/lib/ops/rate-limit-persistent";
import { handleWebhookRequest } from "@/lib/communications/webhook-route";

// Inbound sms provider webhook: rate limited, signature + timestamp verified, idempotent (see webhook-service.ts).
export async function POST(req: Request) {
  const limited = await enforcePersistentLimit(req, "webhook-communications-sms", 600, 60_000);
  if (limited) return limited;
  return handleWebhookRequest(req, "SMS");
}

import type { SecurityEventType } from "@prisma/client";
import { publishSecurityEvent } from "@/lib/security/event-bus";
import type { MobileActor } from "@/lib/mobile/auth";

// Mobile security signals go to the existing security event bus (STEP 24/32). The meta never carries a token, a phone number or anything personal:
// only platform, versions and a reason word. Publishing never throws.

export async function mobileEvent(type: SecurityEventType, actor: MobileActor | null, meta: Record<string, unknown> = {}, outcome?: string): Promise<void> {
  try {
    await publishSecurityEvent({
      eventType: type,
      source: "mobile",
      profileId: actor?.kind === "PROFILE" ? actor.profileId : null,
      familyMemberId: actor?.kind === "FAMILY" ? actor.familyMemberId : null,
      outcome: outcome ?? null,
      meta,
      // A subject is required when there is no signed-in actor; the event is then anonymous.
      subject: actor ? null : "mobile-anonymous",
    });
  } catch {
    /* fail open */
  }
}
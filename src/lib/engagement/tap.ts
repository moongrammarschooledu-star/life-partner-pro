import type { RecordEventInput } from "@/lib/engagement/events";

// STEP 30 - the one-line hook other modules call when something an applicant did (or something that happened to them) should
// become an engagement event. It is deliberately defensive:
//   - the events module is imported lazily, so a module that taps never depends on engagement at load time,
//   - it NEVER throws and never changes the caller's result (a failure is logged and swallowed),
//   - it is awaited by the caller (a serverless function may be frozen after the response, so fire-and-forget is not safe).
// With the engagement flags off, recordEngagementEvent returns immediately and nothing is stored.
export async function tapEngagement(input: RecordEventInput): Promise<void> {
  try {
    const { recordEngagementEvent } = await import("@/lib/engagement/events");
    await recordEngagementEvent(input);
  } catch (error) {
    console.error("[engagement] tap failed", error instanceof Error ? error.message : "error");
  }
}

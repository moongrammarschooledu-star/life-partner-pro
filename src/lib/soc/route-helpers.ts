import { HttpError } from "@/lib/http-error";
import { isFeatureEnabled } from "@/lib/ops/feature-flags";
import { loadViewer, type DbViewer } from "@/lib/analytics/viewers";

// STEP 32 — small helpers every SOC API route shares (each route still calls requireAdmin(<permission>) itself, which the structure tests pin).

export type SocFlag = "soc.enabled" | "soc.detection.enabled" | "soc.escalation.enabled" | "soc.restore_drills.enabled";

// With a flag off the feature does not exist: the API answers 404 with a plain message and nothing is read or written.
export async function assertSocEnabled(...flags: SocFlag[]): Promise<void> {
  for (const f of ["soc.enabled", ...flags] as SocFlag[]) {
    if (!(await isFeatureEnabled(f))) throw new HttpError(404, "This part of Security Operations is not switched on.");
  }
}

// The acting admin's CURRENT access (role, custom role, active flag) — never the login-time snapshot — for anything that approves, changes or assigns.
export async function currentViewer(adminId: string): Promise<DbViewer> {
  const v = await loadViewer(adminId);
  if (!v || !v.active) throw new HttpError(401, "Unauthorized");
  return v;
}

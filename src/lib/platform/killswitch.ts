import type { SystemControl } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { getSystemControl, invalidateSystemControl, SWITCH_FIELD, type EmergencySwitch } from "@/lib/ops/system-control";
import { recordConfigChange } from "@/lib/platform/config-change";
import { assertConfigChangeAllowed } from "@/lib/platform/guard";
import { applyFlagChange, listFlagViews } from "@/lib/platform/flags";

// The emergency kill switch panel (STEP 36 §10): one place that shows, and for most of them operates, the emergency controls the platform already has.
// Engaging a kill switch stops NEW actions only: nothing is deleted, existing data is untouched, and the change is audited and written to the change log.
//
//   emergency switch  SystemControl.emergency*Disabled   (registration, matching, proposals, contact sharing, payments)
//   flag              feature flag state EMERGENCY_DISABLED (WhatsApp, SMS, e-mail, marketing)
//   external          has its own controlled workflow with its own approval (AI kill switch, payment rollout kill switch): shown with a link, not duplicated

export type KillSwitchDef =
  | { key: string; label: string; mechanism: "emergency"; switch: EmergencySwitch; effect: string }
  | { key: string; label: string; mechanism: "flag"; flag: string; effect: string }
  | { key: string; label: string; mechanism: "external"; href: string; effect: string };

export const KILL_SWITCHES: KillSwitchDef[] = [
  { key: "registration", label: "Registration", mechanism: "emergency", switch: "registrations", effect: "New applicant registrations are refused." },
  { key: "matching", label: "Matching", mechanism: "emergency", switch: "matching", effect: "The matching engine stops producing new matches." },
  { key: "proposals", label: "Proposals", mechanism: "emergency", switch: "proposals", effect: "New proposals cannot be created." },
  { key: "contact-sharing", label: "Contact sharing", mechanism: "emergency", switch: "contactSharing", effect: "No NEW contact details are shared between profiles. Nothing already shared is removed." },
  { key: "payments", label: "Payments", mechanism: "emergency", switch: "payments", effect: "New checkout sessions are refused. Existing subscriptions, invoices and refunds are untouched." },
  { key: "whatsapp", label: "WhatsApp", mechanism: "flag", flag: "whatsapp.enabled", effect: "No WhatsApp messages are sent." },
  { key: "sms", label: "SMS", mechanism: "flag", flag: "sms.enabled", effect: "No text messages are sent." },
  { key: "email", label: "E-mail", mechanism: "flag", flag: "email.enabled", effect: "No e-mails are sent (sign-in and reset codes are not affected)." },
  { key: "marketing", label: "Marketing", mechanism: "flag", flag: "marketing.enabled", effect: "Marketing centre, lead capture and automation stop." },
  { key: "ai", label: "AI", mechanism: "external", href: "/admin/ai", effect: "Use the AI kill switch: it has its own approval workflow." },
];

export interface KillSwitchView {
  key: string;
  label: string;
  mechanism: "emergency" | "flag" | "external";
  effect: string;
  engaged: boolean | null;
  href?: string;
}

function emergencyOn(control: SystemControl, sw: EmergencySwitch): boolean {
  return Boolean(control[SWITCH_FIELD[sw]]);
}

export async function listKillSwitches(): Promise<KillSwitchView[]> {
  const [control, flags, ai] = await Promise.all([getSystemControl(), listFlagViews(), prisma.aiConfig.findUnique({ where: { id: 1 }, select: { killSwitchActive: true } })]);
  const flagState = new Map(flags.map((f) => [f.key, f.state]));
  return KILL_SWITCHES.map((k) => {
    if (k.mechanism === "emergency") return { key: k.key, label: k.label, mechanism: k.mechanism, effect: k.effect, engaged: emergencyOn(control, k.switch) || control.operationalState === "EMERGENCY" };
    if (k.mechanism === "flag") return { key: k.key, label: k.label, mechanism: k.mechanism, effect: k.effect, engaged: flagState.get(k.flag) === "EMERGENCY_DISABLED" || flagState.get(k.flag) === "DISABLED" };
    return { key: k.key, label: k.label, mechanism: k.mechanism, effect: k.effect, engaged: ai?.killSwitchActive ?? false, href: k.href };
  });
}

export async function setKillSwitch(admin: SessionAdmin, input: { key: unknown; engage: unknown; reason: unknown; environment: unknown }) {
  if (!admin.permissions.includes("platform:features:manage") && !admin.permissions.includes("platform:maintenance:manage")) throw new ApiError(403, "Forbidden: insufficient permissions");
  const def = KILL_SWITCHES.find((k) => k.key === input.key);
  if (!def) throw new ApiError(400, "Unknown kill switch.");
  if (def.mechanism === "external") throw new ApiError(400, "This kill switch is operated in its own screen, which has its own approval workflow.");
  if (typeof input.engage !== "boolean") throw new ApiError(400, "engage must be true or false.");

  if (def.mechanism === "flag") {
    if (!admin.permissions.includes("platform:features:manage")) throw new ApiError(403, "Forbidden: insufficient permissions");
    // Engaging = EMERGENCY_DISABLED (restrictive, never needs approval). Releasing = back to ENABLED, which for a sensitive flag in production is an activation.
    return applyFlagChange(admin, { key: def.flag, state: input.engage ? "EMERGENCY_DISABLED" : "ENABLED", reason: input.reason, environment: input.environment });
  }

  // emergency switch
  if (!admin.permissions.includes("platform:maintenance:manage")) throw new ApiError(403, "Forbidden: insufficient permissions");
  const ctx = await assertConfigChangeAllowed({ admin, environment: input.environment, reason: input.reason, restrictive: input.engage === true, what: { kind: "SYSTEM_CONTROL", key: `emergency.${def.switch}` } });
  const field = SWITCH_FIELD[def.switch];
  const before = await getSystemControl();
  if (Boolean(before[field]) === input.engage) throw new ApiError(409, input.engage ? "That kill switch is already engaged." : "That kill switch is already released.");
  await prisma.systemControl.upsert({ where: { id: 1 }, update: { [field]: input.engage, updatedById: admin.id }, create: { id: 1, [field]: input.engage, updatedById: admin.id } });
  invalidateSystemControl();
  await recordConfigChange({ kind: "SYSTEM_CONTROL", key: `emergency.${def.switch}`, before: { engaged: !input.engage }, after: { engaged: input.engage }, actor: admin, reason: ctx.reason, environment: ctx.environment });
  await writeAudit({ action: "EMERGENCY_SWITCH_CHANGED", adminId: admin.id, meta: { switch: def.switch, engaged: input.engage, via: ctx.via, source: "control-center", reason: ctx.reason } });
  return { approvalRequired: false as const, engaged: input.engage };
}

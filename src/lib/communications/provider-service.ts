import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { HttpError } from "@/lib/http-error";
import { enforceApprovalGate, markApprovalExecuted } from "@/lib/approvals/gate";
import type { SessionAdmin } from "@/lib/route-guard";
import type { CommunicationEnvironment, CommunicationProvider, NotificationChannel } from "@prisma/client";
import { buildAdapter } from "@/lib/communications/providers/registry";

// Provider administration. What is stored is CONFIGURATION ONLY: which adapter, which environment, sender label, countries,
// languages, retry policy and the NAMES of the environment variables that hold credentials. A secret value can never be entered
// here, is never returned, and never appears in an audit entry - credentials live in server environment variables only.

export const ADAPTERS: Record<string, NotificationChannel> = { EMAIL_SMTP: "EMAIL", SMS_TWILIO: "SMS", WHATSAPP_META: "WHATSAPP", INAPP: "IN_APP", SANDBOX: "EMAIL" }; // SANDBOX is allowed on any channel (checked below)
const ENVIRONMENTS: CommunicationEnvironment[] = ["DEVELOPMENT", "STAGING", "SANDBOX", "PRODUCTION"];

// Environment variable names each adapter reads, so "which secrets are configured" can be reported WITHOUT their values.
export const ADAPTER_SECRET_NAMES: Record<string, string[]> = {
  EMAIL_SMTP: ["SMTP_USER", "SMTP_PASS", "EMAIL_WEBHOOK_SECRET"],
  SMS_TWILIO: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER|TWILIO_MESSAGING_SERVICE_SID"],
  WHATSAPP_META: ["WHATSAPP_ENABLED", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET", "WHATSAPP_VERIFY_TOKEN"],
  INAPP: [],
  SANDBOX: [],
};

export interface ProviderInput {
  providerKey: string;
  name: string;
  channel: NotificationChannel;
  adapter: string;
  environment: CommunicationEnvironment;
  priority?: number;
  senderIdentity?: string | null;
  supportedCountries?: string[];
  supportedLanguages?: string[];
  rateLimitPerMinute?: number;
  retryMaxAttempts?: number;
  retryBaseSeconds?: number;
  processorId?: string | null;
  failoverAllowed?: boolean;
}

// Never lets a request smuggle a value in through a free-text field.
const SECRET_LIKE = /(^|[^a-z])(sk|pk|ac|xox[bp]|ghp|eaa)[-_a-z0-9]{16,}|bearer\s+[a-z0-9._-]{16,}|password\s*[:=]|token\s*[:=]|secret\s*[:=]/i;

function validate(input: Partial<ProviderInput>, existing?: CommunicationProvider): void {
  if (!existing || input.providerKey !== undefined) if (!/^[a-z0-9][a-z0-9-]{2,60}$/.test(input.providerKey ?? existing?.providerKey ?? "")) throw new HttpError(422, "providerKey must be 3-61 lowercase letters, digits or dashes.");
  if (input.name !== undefined && input.name.trim().length < 3) throw new HttpError(422, "A provider name is required.");
  const adapter = input.adapter ?? existing?.adapter ?? "";
  const channel = input.channel ?? existing?.channel;
  if (!(adapter in ADAPTERS)) throw new HttpError(422, "Unknown adapter.");
  if (adapter !== "SANDBOX" && channel !== ADAPTERS[adapter]) throw new HttpError(422, `The ${adapter} adapter serves the ${ADAPTERS[adapter]} channel.`);
  if (input.environment !== undefined && !ENVIRONMENTS.includes(input.environment)) throw new HttpError(422, "Unknown environment.");
  const int = (v: unknown, min: number, max: number) => v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max);
  if (!int(input.priority, 1, 1000) || !int(input.rateLimitPerMinute, 1, 100_000) || !int(input.retryMaxAttempts, 1, 10) || !int(input.retryBaseSeconds, 5, 3600)) throw new HttpError(422, "A numeric setting is out of range.");
  for (const list of [input.supportedCountries, input.supportedLanguages]) {
    if (list !== undefined && (!Array.isArray(list) || list.length > 100 || list.some((x) => typeof x !== "string" || x.length > 60))) throw new HttpError(422, "Country / language lists must be short lists of names.");
  }
  if (input.supportedLanguages?.some((l) => !["EN", "UR"].includes(l))) throw new HttpError(422, "Languages must be EN or UR.");
  for (const text of [input.name, input.senderIdentity, input.providerKey]) if (text && SECRET_LIKE.test(text)) throw new HttpError(422, "That looks like a credential. Credentials are set as server environment variables, never here.");
}

// Public shape: configuration + which credential NAMES are present (never values).
export function serializeProvider(p: CommunicationProvider, env: Record<string, string | undefined> = process.env) {
  const names = ADAPTER_SECRET_NAMES[p.adapter] ?? [];
  const present = (n: string) => n.split("|").some((alt) => Boolean(env[alt]?.trim()));
  const adapter = buildAdapter(p.adapter, p.channel, env);
  return {
    id: p.id,
    providerKey: p.providerKey,
    name: p.name,
    channel: p.channel,
    adapter: p.adapter,
    environment: p.environment,
    active: p.active,
    priority: p.priority,
    senderIdentity: p.senderIdentity,
    supportedCountries: JSON.parse(p.supportedCountries || "[]") as string[],
    supportedLanguages: JSON.parse(p.supportedLanguages || "[]") as string[],
    rateLimitPerMinute: p.rateLimitPerMinute,
    retryMaxAttempts: p.retryMaxAttempts,
    retryBaseSeconds: p.retryBaseSeconds,
    processorId: p.processorId,
    failoverAllowed: p.failoverAllowed,
    healthStatus: p.healthStatus,
    lastSuccessAt: p.lastSuccessAt,
    lastFailureAt: p.lastFailureAt,
    lastWebhookAt: p.lastWebhookAt,
    lastError: p.lastError,
    credentials: names.map((n) => ({ name: n, configured: present(n) })), // names + yes/no only
    configured: adapter?.isConfigured() ?? false,
  };
}

export async function listProviders() {
  const rows = await prisma.communicationProvider.findMany({ orderBy: [{ channel: "asc" }, { priority: "asc" }] });
  return rows.map((p) => serializeProvider(p));
}

export async function createProvider(actor: SessionAdmin, input: ProviderInput) {
  validate(input);
  if (await prisma.communicationProvider.findUnique({ where: { providerKey: input.providerKey } })) throw new HttpError(409, "A provider with that key already exists.");
  if (input.processorId && !(await prisma.complianceProcessor.findUnique({ where: { id: input.processorId }, select: { id: true } }))) throw new HttpError(422, "Unknown compliance processor.");
  // A new provider is created INACTIVE: turning it on is a separate, approved step.
  const row = await prisma.communicationProvider.create({
    data: {
      providerKey: input.providerKey,
      name: input.name.trim(),
      channel: input.channel,
      adapter: input.adapter,
      environment: input.environment,
      active: false,
      priority: input.priority ?? 100,
      senderIdentity: input.senderIdentity?.trim() || null,
      supportedCountries: JSON.stringify(input.supportedCountries ?? []),
      supportedLanguages: JSON.stringify(input.supportedLanguages ?? []),
      rateLimitPerMinute: input.rateLimitPerMinute ?? 60,
      retryMaxAttempts: input.retryMaxAttempts ?? 4,
      retryBaseSeconds: input.retryBaseSeconds ?? 60,
      secretRefs: JSON.stringify(ADAPTER_SECRET_NAMES[input.adapter] ?? []),
      processorId: input.processorId ?? null,
      failoverAllowed: input.failoverAllowed ?? false,
      updatedById: actor.id,
    },
  });
  await writeAudit({ action: "COMMUNICATION_PROVIDER_CHANGED", adminId: actor.id, meta: { providerKey: row.providerKey, change: "CREATED", adapter: row.adapter, environment: row.environment } });
  return serializeProvider(row);
}

export type ProviderChangeResult = { approvalRequired: false; provider: ReturnType<typeof serializeProvider> } | { approvalRequired: true; approvalCode: string; status: string };

// Changes that alter WHERE traffic goes (activation, priority, failover, processor, environment, countries) need the STEP 19 gate;
// cosmetic / tuning changes do not.
const ROUTING_FIELDS: Array<keyof ProviderInput | "active"> = ["active", "priority", "failoverAllowed", "processorId", "environment", "adapter", "supportedCountries"];

export async function updateProvider(actor: SessionAdmin, id: string, patch: Partial<Omit<ProviderInput, "providerKey">> & { active?: boolean }): Promise<ProviderChangeResult> {
  const existing = await prisma.communicationProvider.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, "Provider not found.");
  validate({ ...patch, providerKey: undefined }, existing);
  if (patch.processorId && !(await prisma.complianceProcessor.findUnique({ where: { id: patch.processorId }, select: { id: true } }))) throw new HttpError(422, "Unknown compliance processor.");
  if (patch.active === true && existing.environment === "PRODUCTION" && existing.adapter !== "SANDBOX") {
    const adapter = buildAdapter(patch.adapter ?? existing.adapter, patch.channel ?? existing.channel);
    if (!adapter?.isConfigured()) throw new HttpError(409, "The provider's credentials are not configured in this environment, so it cannot be activated.");
  }

  const routing = ROUTING_FIELDS.some((f) => (patch as Record<string, unknown>)[f] !== undefined && JSON.stringify((patch as Record<string, unknown>)[f]) !== JSON.stringify(f === "supportedCountries" ? JSON.parse(existing.supportedCountries) : (existing as unknown as Record<string, unknown>)[f]));
  let approvalNote: string | null = null;
  if (routing) {
    const gate = await enforceApprovalGate({ actionType: "COMMUNICATION_PROVIDER_CHANGE", sourceType: "CASE", sourceId: existing.id, actor, reason: `Change provider ${existing.providerKey}`, requestedPayload: { providerId: id, ...patch } });
    if (gate.requiresApproval && gate.status !== "READY_TO_EXECUTE") return { approvalRequired: true, approvalCode: gate.approvalCode, status: gate.status };
    if (gate.requiresApproval) {
      await markApprovalExecuted(gate.approvalRequestId, actor.id);
      approvalNote = gate.approvalRequestId;
    }
  }

  const data: Record<string, unknown> = { updatedById: actor.id };
  for (const key of ["name", "environment", "active", "priority", "senderIdentity", "rateLimitPerMinute", "retryMaxAttempts", "retryBaseSeconds", "processorId", "failoverAllowed", "adapter", "channel"] as const) {
    if ((patch as Record<string, unknown>)[key] !== undefined) data[key] = (patch as Record<string, unknown>)[key];
  }
  if (patch.supportedCountries !== undefined) data.supportedCountries = JSON.stringify(patch.supportedCountries);
  if (patch.supportedLanguages !== undefined) data.supportedLanguages = JSON.stringify(patch.supportedLanguages);
  if (typeof data.name === "string") data.name = data.name.trim();
  const row = await prisma.communicationProvider.update({ where: { id }, data });
  await writeAudit({ action: "COMMUNICATION_PROVIDER_CHANGED", adminId: actor.id, meta: { providerKey: row.providerKey, changedFields: Object.keys(data).filter((k) => k !== "updatedById"), approvalRequestId: approvalNote } });
  return { approvalRequired: false, provider: serializeProvider(row) };
}

// Live probe of one provider (uses its real health endpoint when configured); records the result. No message is sent.
export async function probeProvider(actor: SessionAdmin, id: string) {
  const row = await prisma.communicationProvider.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Provider not found.");
  const adapter = buildAdapter(row.adapter, row.channel);
  if (!adapter) throw new HttpError(422, "This provider has no adapter.");
  const health = await adapter.checkProviderHealth();
  await prisma.communicationProvider.update({ where: { id }, data: { healthStatus: health.status, ...(health.status === "HEALTHY" ? { lastSuccessAt: new Date(), consecutiveFailures: 0 } : { lastFailureAt: new Date(), lastError: health.detail?.slice(0, 200) ?? null }) } });
  await writeAudit({ action: "COMMUNICATION_PROVIDER_CHANGED", adminId: actor.id, meta: { providerKey: row.providerKey, change: "HEALTH_PROBE", status: health.status } });
  return health;
}

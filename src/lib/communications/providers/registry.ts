import { prisma } from "@/lib/prisma";
import type { CommunicationEnvironment, CommunicationProvider as ProviderRow, NotificationChannel } from "@prisma/client";
import { currentEnvironment, isTestRecipient } from "@/lib/communications/environment";
import { EmailProviderAdapter } from "@/lib/communications/providers/email-adapter";
import { SmsProviderAdapter } from "@/lib/communications/providers/sms-adapter";
import { WhatsAppProviderAdapter } from "@/lib/communications/providers/whatsapp-adapter";
import { SandboxProviderAdapter } from "@/lib/communications/providers/sandbox-adapter";
import { InAppProviderAdapter } from "@/lib/communications/providers/inapp-adapter";
import type { CommunicationProvider } from "@/lib/communications/providers/types";

// Provider registry. Application code asks for "the providers to try for this channel and recipient" and gets back ordered
// adapters; it never names a vendor. Rules applied here:
//   1. Active CommunicationProvider rows (admin-configured, non-secret) win; with no rows the built-in default per channel is used
//      (real adapter when its environment credentials exist, otherwise the sandbox).
//   2. A row only counts in its own environment (a PRODUCTION row is ignored in staging), and only for the countries / languages
//      it lists (empty list = any).
//   3. The ENVIRONMENT GUARD: outside PRODUCTION a real (external) adapter is replaced by the sandbox unless the destination is an
//      allow-listed test recipient.
//   4. FAILOVER is opt-in per provider (`failoverAllowed`) and, when it is linked to a ComplianceProcessor, that processor must be
//      COMPLIANT - so data never silently moves to an unapproved provider.

export interface ResolvedProvider {
  adapter: CommunicationProvider;
  providerKey: string;
  row: ProviderRow | null;
  sandboxed: boolean; // true when the environment guard (or missing credentials) replaced a real adapter
  failover: boolean;
}

export interface ResolveContext {
  channel: NotificationChannel;
  destination: string;
  country?: string | null;
  language?: string | null;
  environment?: CommunicationEnvironment;
  env?: Record<string, string | undefined>;
  testRecipientsConfigured?: readonly string[];
}

export function buildAdapter(adapterKey: string, channel: NotificationChannel, env: Record<string, string | undefined> = process.env): CommunicationProvider | null {
  switch (adapterKey) {
    case "EMAIL_SMTP":
      return channel === "EMAIL" ? new EmailProviderAdapter(env) : null;
    case "SMS_TWILIO":
      return channel === "SMS" ? new SmsProviderAdapter(env) : null;
    case "WHATSAPP_META":
      return channel === "WHATSAPP" ? new WhatsAppProviderAdapter(env) : null;
    case "INAPP":
      return channel === "IN_APP" ? new InAppProviderAdapter() : null;
    case "SANDBOX":
      return new SandboxProviderAdapter(channel, env);
    default:
      return null;
  }
}

function builtinFor(channel: NotificationChannel, env: Record<string, string | undefined>): { adapter: CommunicationProvider; providerKey: string } {
  if (channel === "IN_APP") return { adapter: new InAppProviderAdapter(), providerKey: "inapp" };
  const real = buildAdapter(channel === "EMAIL" ? "EMAIL_SMTP" : channel === "SMS" ? "SMS_TWILIO" : "WHATSAPP_META", channel, env);
  if (real && real.isConfigured()) return { adapter: real, providerKey: `builtin-${real.adapterKey.toLowerCase()}` };
  return { adapter: new SandboxProviderAdapter(channel, env), providerKey: `sandbox-${channel.toLowerCase()}` };
}

function jsonList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function resolveProviderChain(ctx: ResolveContext): Promise<ResolvedProvider[]> {
  const env = ctx.env ?? process.env;
  const environment = ctx.environment ?? currentEnvironment(env);
  const guard = (adapter: CommunicationProvider, providerKey: string, row: ProviderRow | null, failover: boolean): ResolvedProvider => {
    if (adapter.external && environment !== "PRODUCTION" && !isTestRecipient(ctx.destination, env, ctx.testRecipientsConfigured)) {
      return { adapter: new SandboxProviderAdapter(ctx.channel, env), providerKey: `sandbox-${ctx.channel.toLowerCase()}`, row, sandboxed: true, failover };
    }
    return { adapter, providerKey, row, sandboxed: false, failover };
  };

  let rows: ProviderRow[] = [];
  try {
    rows = await prisma.communicationProvider.findMany({ where: { channel: ctx.channel, active: true }, orderBy: { priority: "asc" } });
  } catch {
    rows = []; // a config read problem must not stop delivery: fall back to the built-in default below
  }

  const usable = rows.filter((r) => {
    if (r.environment !== environment && r.environment !== "SANDBOX") return false;
    const countries = jsonList(r.supportedCountries);
    const languages = jsonList(r.supportedLanguages);
    if (countries.length && ctx.country && !countries.map((c) => c.toLowerCase()).includes(ctx.country.toLowerCase())) return false;
    if (languages.length && ctx.language && !languages.includes(ctx.language)) return false;
    return true;
  });

  const chain: ResolvedProvider[] = [];
  for (const row of usable) {
    const adapter = buildAdapter(row.adapter, ctx.channel, env);
    if (!adapter || !adapter.isConfigured()) continue; // an active row whose credentials are missing is skipped (surfaced by health)
    chain.push(guard(adapter, row.providerKey, row, chain.length > 0));
  }

  if (chain.length === 0) {
    const b = builtinFor(ctx.channel, env);
    return [guard(b.adapter, b.providerKey, null, false)];
  }
  return chain;
}

// Failover candidates beyond the first are only those explicitly allowed (and, where linked, processor-approved).
export async function eligibleFailoverChain(chain: ResolvedProvider[]): Promise<ResolvedProvider[]> {
  if (chain.length <= 1) return chain;
  const out: ResolvedProvider[] = [chain[0]];
  for (const candidate of chain.slice(1)) {
    const row = candidate.row;
    if (!row || !row.failoverAllowed) continue;
    if (row.processorId) {
      const processor = await prisma.complianceProcessor.findUnique({ where: { id: row.processorId }, select: { complianceStatus: true } }).catch(() => null);
      if (!processor || processor.complianceStatus !== "COMPLIANT") continue;
    }
    out.push(candidate);
  }
  return out;
}

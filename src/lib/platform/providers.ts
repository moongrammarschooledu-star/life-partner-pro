import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { checkDatabase, getHealthReport } from "@/lib/ops/health";
import { buildAdapter } from "@/lib/communications/providers/registry";
import { ADAPTER_SECRET_NAMES, probeProvider } from "@/lib/communications/provider-service";
import { currentEnvironment } from "@/lib/platform/environment-core";
import { CATEGORY_LABEL, fromCommunicationProvider, fromHealthCheck, fromMarketingConnection, outcomeToStatus, safeDiagnostic, type ProviderStatus, type TestOutcome } from "@/lib/platform/provider-status";

// Provider management center (STEP 36 §12–§21). One list of every provider with one status vocabulary, and a SAFE test connection.
//   * Credentials are never read into a response: only names and yes/no flags, from the existing provider services.
//   * Provider CHANGES (switching the payment provider, editing a communications provider, AI configuration) stay in their own editors, which already carry
//     their approvals. This module adds status, health history and the test, and links to the editors.
//   * A test never sends a message, never charges, never changes data. It only checks that the provider answers (or that credentials are present where a call
//     would cost money or touch customers), and stores a short, redacted diagnostic.

export interface ProviderView {
  key: string;
  category: string;
  categoryLabel: string;
  label: string;
  status: ProviderStatus;
  environment: string;
  enabledFeatures: string[];
  notes: string;
  manageHref: string | null;
  testable: boolean;
  lastCheck: { outcome: string; checkedAt: Date; latencyMs: number | null } | null;
  lastSuccessAt: Date | null;
}

const TIMEOUT_MS = 5000;

function withTimeout<T>(promise: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

const present = (name: string, env: Record<string, string | undefined> = process.env) => name.split("|").some((alt) => Boolean(env[alt]?.trim()));

export async function listProviderViews(): Promise<ProviderView[]> {
  const env = currentEnvironment();
  const [report, comm, ai, settings, marketing, checks] = await Promise.all([
    getHealthReport({ detail: true }),
    prisma.communicationProvider.findMany({ orderBy: [{ channel: "asc" }, { priority: "asc" }] }),
    prisma.aiConfig.findUnique({ where: { id: 1 } }),
    prisma.appSettings.findUnique({ where: { id: 1 }, select: { activePaymentProvider: true, paymentRolloutStage: true } }),
    prisma.marketingProviderConnection.findMany(),
    prisma.platformProviderCheck.findMany({ orderBy: { checkedAt: "desc" }, take: 300 }),
  ]);
  const latest = new Map<string, (typeof checks)[number]>();
  for (const c of checks) if (!latest.has(c.providerKey)) latest.set(c.providerKey, c);
  const view = (v: Omit<ProviderView, "categoryLabel" | "lastCheck" | "environment"> & { environment?: string }): ProviderView => {
    const c = latest.get(v.key);
    return { ...v, environment: v.environment ?? env, categoryLabel: CATEGORY_LABEL[v.category] ?? v.category, lastCheck: c ? { outcome: c.outcome, checkedAt: c.checkedAt, latencyMs: c.latencyMs } : null };
  };
  const out: ProviderView[] = [];

  out.push(view({ key: "database", category: "database", label: "PostgreSQL database", status: fromHealthCheck(report.checks.database?.status ?? "unknown"), enabledFeatures: ["All data"], notes: report.checks.database?.detail ?? "", manageHref: "/admin/system-health", testable: true, lastSuccessAt: null }));
  out.push(view({ key: "storage", category: "storage", label: "File storage (Vercel Blob)", status: fromHealthCheck(report.checks.storage?.status ?? "unknown"), enabledFeatures: ["Photos", "Documents", "Backups"], notes: report.checks.storage?.detail ?? "", manageHref: "/admin/system-health", testable: true, lastSuccessAt: null }));
  out.push(view({ key: "auth", category: "authentication", label: "Sign-in (session secret, e-mail codes)", status: fromHealthCheck(report.checks.authentication?.status ?? "unknown"), enabledFeatures: ["Administrator sign-in", "Applicant sign-in", "Family sign-in"], notes: "Credentials are checked by presence only.", manageHref: "/admin/settings", testable: true, lastSuccessAt: null }));

  for (const p of comm) {
    const names = ADAPTER_SECRET_NAMES[p.adapter] ?? [];
    const adapter = buildAdapter(p.adapter, p.channel);
    const configured = adapter?.isConfigured() ?? names.every((n) => present(n));
    const category = p.channel === "EMAIL" ? "email" : p.channel === "SMS" ? "sms" : p.channel === "WHATSAPP" ? "whatsapp" : "in_app";
    out.push(view({ key: `comm:${p.providerKey}`, category, label: p.name, status: fromCommunicationProvider(p, configured), environment: p.environment, enabledFeatures: [`Priority ${p.priority}`, p.failoverAllowed ? "Failover allowed" : "No failover", `${p.rateLimitPerMinute}/min`], notes: p.lastError ? safeDiagnostic(p.lastError) : "", manageHref: "/admin/communications", testable: p.adapter !== "INAPP", lastSuccessAt: p.lastSuccessAt }));
  }

  const activePayment = settings?.activePaymentProvider ?? "MANUAL";
  out.push(view({ key: "payments:MANUAL", category: "payments", label: `Manual / bank transfer${activePayment === "MANUAL" ? " (active)" : ""}`, status: "HEALTHY", enabledFeatures: ["Bank-transfer payments", `Rollout stage: ${settings?.paymentRolloutStage ?? "DISABLED"}`], notes: "Runs inside the platform; no external provider.", manageHref: "/admin/finance-center", testable: true, lastSuccessAt: null }));
  const stripeConfigured = present("STRIPE_SECRET_KEY");
  out.push(view({ key: "payments:STRIPE", category: "payments", label: `Stripe${activePayment === "STRIPE" ? " (active)" : ""}`, status: stripeConfigured ? "CONNECTED" : "NOT_CONFIGURED", enabledFeatures: ["Card payments"], notes: stripeConfigured ? "Credentials present." : "No Stripe credentials are configured.", manageHref: "/admin/finance-center", testable: true, lastSuccessAt: null }));

  const aiStatus: ProviderStatus = !ai || ai.provider === "DISABLED" || ai.killSwitchActive || ai.phase === "DISABLED" ? "DISABLED" : ai.provider === "RULES" ? "HEALTHY" : present("ANTHROPIC_API_KEY") ? "CONNECTED" : "NOT_CONFIGURED";
  out.push(view({ key: "ai", category: "ai", label: ai?.provider === "ANTHROPIC" ? "AI provider (external model)" : "AI (built-in rules engine)", status: aiStatus, enabledFeatures: [`Phase: ${ai?.phase ?? "DISABLED"}`, ai?.externalProviderAllowed ? "External provider allowed" : "No data leaves the platform"], notes: ai?.killSwitchActive ? "The AI kill switch is engaged." : "", manageHref: "/admin/ai", testable: true, lastSuccessAt: null }));

  for (const m of marketing) {
    out.push(view({ key: `marketing:${m.providerKey}`, category: "marketing", label: `Marketing connection: ${m.providerKey}`, status: fromMarketingConnection(m.status), environment: m.environment, enabledFeatures: [m.webhookStatus ? `Webhook ${m.webhookStatus}` : "No webhook"], notes: m.lastError ? safeDiagnostic(m.lastError) : "", manageHref: "/admin/marketing", testable: false, lastSuccessAt: m.lastSyncAt }));
  }

  out.push(view({ key: "monitoring:jobs", category: "monitoring", label: "Background jobs (scheduled tick, queue)", status: fromHealthCheck(report.checks.cron?.status ?? "unknown"), enabledFeatures: ["Daily tick", "Notification queue"], notes: report.checks.cron?.detail ?? "", manageHref: "/admin/system-health", testable: false, lastSuccessAt: null }));
  out.push(view({ key: "monitoring:uptime", category: "monitoring", label: "External uptime probe", status: "NOT_CONFIGURED", enabledFeatures: [], notes: "The probe runs outside the platform (a scheduled GitHub workflow); the platform cannot verify it from here.", manageHref: null, testable: false, lastSuccessAt: null }));
  out.push(view({ key: "analytics:external", category: "analytics", label: "External analytics provider", status: "NOT_CONFIGURED", enabledFeatures: [], notes: "None. Analytics are first-party only (see Analytics).", manageHref: "/admin/analytics", testable: false, lastSuccessAt: null }));
  return out;
}

export interface TestResult {
  providerKey: string;
  outcome: TestOutcome;
  status: ProviderStatus;
  latencyMs: number | null;
  detail: string;
}

async function runTest(admin: SessionAdmin, key: string): Promise<{ outcome: TestOutcome; detail: string; category: string }> {
  const safe = async <T,>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; timeout: boolean }> => {
    try {
      return { ok: true, value: await withTimeout(fn()) };
    } catch (err) {
      return { ok: false, timeout: err instanceof Error && err.message === "timeout" };
    }
  };

  if (key === "database") {
    const r = await safe(() => checkDatabase());
    if (!r.ok) return { outcome: r.timeout ? "TIMEOUT" : "FAILED", detail: "The database did not answer.", category: "database" };
    return { outcome: r.value.status === "ok" ? "SUCCESS" : "FAILED", detail: `Answered in ${r.value.latencyMs} ms.`, category: "database" };
  }
  if (key === "storage") {
    if (!present("BLOB_READ_WRITE_TOKEN")) return { outcome: "NOT_CONFIGURED", detail: "No storage token is configured.", category: "storage" };
    const r = await safe(async () => {
      const { list } = await import("@vercel/blob");
      await list({ limit: 1 });
      return true;
    });
    if (!r.ok) return { outcome: r.timeout ? "TIMEOUT" : "FAILED", detail: r.timeout ? "Storage did not answer in time." : "Storage rejected the request.", category: "storage" };
    return { outcome: "SUCCESS", detail: "Storage answered a read-only listing.", category: "storage" };
  }
  if (key === "auth") {
    return present("NEXTAUTH_SECRET|AUTH_SECRET") ? { outcome: "SUCCESS", detail: "The session secret is present.", category: "authentication" } : { outcome: "FAILED", detail: "The session secret is missing.", category: "authentication" };
  }
  if (key.startsWith("comm:")) {
    const row = await prisma.communicationProvider.findUnique({ where: { providerKey: key.slice(5) } });
    if (!row) throw new ApiError(404, "Provider not found.");
    const adapter = buildAdapter(row.adapter, row.channel);
    if (!adapter || !adapter.isConfigured()) return { outcome: "NOT_CONFIGURED", detail: "Credentials are not configured.", category: row.channel.toLowerCase() };
    // The existing provider probe: asks the adapter for its health. It sends no message.
    const r = await safe(() => probeProvider(admin, row.id));
    if (!r.ok) return { outcome: r.timeout ? "TIMEOUT" : "FAILED", detail: "The provider did not answer.", category: row.channel.toLowerCase() };
    return { outcome: r.value.status === "HEALTHY" ? "SUCCESS" : "FAILED", detail: safeDiagnostic(r.value.detail) || `Reported ${r.value.status}.`, category: row.channel.toLowerCase() };
  }
  if (key === "payments:MANUAL") return { outcome: "SUCCESS", detail: "Manual payments run inside the platform.", category: "payments" };
  if (key === "payments:STRIPE") {
    if (!present("STRIPE_SECRET_KEY")) return { outcome: "NOT_CONFIGURED", detail: "No Stripe credentials are configured.", category: "payments" };
    // A read-only balance request: it moves no money and creates nothing. The key is sent to Stripe and never returned or logged.
    const r = await safe(async () => (await fetch("https://api.stripe.com/v1/balance", { headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` }, signal: AbortSignal.timeout(TIMEOUT_MS) })).status);
    if (!r.ok) return { outcome: r.timeout ? "TIMEOUT" : "FAILED", detail: "Stripe did not answer.", category: "payments" };
    return { outcome: r.value === 200 ? "SUCCESS" : "FAILED", detail: r.value === 200 ? "Stripe accepted the credentials." : `Stripe answered ${r.value}.`, category: "payments" };
  }
  if (key === "ai") {
    const ai = await prisma.aiConfig.findUnique({ where: { id: 1 } });
    if (!ai || ai.provider === "DISABLED") return { outcome: "NOT_CONFIGURED", detail: "AI is disabled.", category: "ai" };
    if (ai.provider === "RULES") return { outcome: "SUCCESS", detail: "The built-in rules engine needs no external call.", category: "ai" };
    // An external model costs money per call and handles content, so a test only checks that a key is present.
    return present("ANTHROPIC_API_KEY") ? { outcome: "SUCCESS", detail: "A key is present (not called, to avoid cost).", category: "ai" } : { outcome: "NOT_CONFIGURED", detail: "No key is configured.", category: "ai" };
  }
  throw new ApiError(400, "This provider cannot be tested from here.");
}

export async function testProvider(admin: SessionAdmin, key: unknown): Promise<TestResult> {
  if (!admin.permissions.includes("platform:providers:manage")) throw new ApiError(403, "Forbidden: insufficient permissions");
  if (typeof key !== "string" || key.length > 80 || !/^[A-Za-z0-9:_.-]+$/.test(key)) throw new ApiError(400, "Unknown provider.");
  const started = Date.now();
  const { outcome, detail, category } = await runTest(admin, key);
  const latencyMs = Date.now() - started;
  const status = outcomeToStatus(outcome);
  const clean = safeDiagnostic(detail);
  await prisma.platformProviderCheck.create({ data: { providerKey: key, category, outcome, health: status, latencyMs, detail: clean, checkedById: admin.id } });
  await writeAudit({ action: "PLATFORM_PROVIDER_TESTED", adminId: admin.id, meta: { providerKey: key, outcome } });
  return { providerKey: key, outcome, status, latencyMs, detail: clean };
}

export async function providerCheckHistory(key: string, limit = 20) {
  return prisma.platformProviderCheck.findMany({ where: { providerKey: key }, orderBy: { checkedAt: "desc" }, take: Math.min(50, limit), select: { id: true, outcome: true, health: true, latencyMs: true, detail: true, checkedAt: true } });
}

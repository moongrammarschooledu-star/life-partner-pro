import { writeAudit } from "@/lib/audit";
import { ApiError, type SessionAdmin } from "@/lib/route-guard";
import { currentEnvironment } from "@/lib/platform/environment-core";
import { safeConfigValue } from "@/lib/platform/config-values";
import { SETTING_DEFS } from "@/lib/platform/settings-registry";
import { getPlatformSettings } from "@/lib/platform/settings";
import { SPEC_FLAGS, listFlagViews } from "@/lib/platform/flags";
import { listProviderViews } from "@/lib/platform/providers";
import { getMaintenanceView } from "@/lib/platform/maintenance";
import { sectionsFor } from "@/lib/platform/sections";

// Configuration search (STEP 36 §53) and safe export (§54).
// Search matches KEYS, labels, categories, providers, features and statuses. It never matches or returns a stored value, so a secret that ended up in a value
// could not be found this way. Export carries safe metadata only: every value goes through safeConfigValue, no provider credential (not even a name) is
// included, and there is no import (the brief says "if implemented"; an import would need its own approval design).

export interface SearchHit {
  type: "setting" | "feature" | "provider" | "section";
  key: string;
  label: string;
  category: string;
  status?: string;
  href: string;
}

const norm = (s: string) => s.toLowerCase();

export async function searchConfiguration(admin: SessionAdmin, params: { q?: string; type?: string; status?: string; category?: string }): Promise<SearchHit[]> {
  const can = (p: string) => admin.permissions.includes(p as never);
  const q = norm((params.q ?? "").trim().slice(0, 80));
  const hits: SearchHit[] = [];
  const wanted = (t: SearchHit["type"]) => !params.type || params.type === t;
  const match = (...parts: Array<string | undefined>) => !q || parts.some((p) => p && norm(p).includes(q));

  if (wanted("section")) for (const s of sectionsFor(admin.permissions)) if (match(s.key, s.label, s.description, s.group)) hits.push({ type: "section", key: s.key, label: s.label, category: s.group, href: s.page ?? `/admin/control-center/${s.key}` });
  if (wanted("setting") && can("platform:settings:view")) for (const d of SETTING_DEFS) if (match(d.key, d.label, d.category, d.description)) hits.push({ type: "setting", key: d.key, label: d.label, category: d.category, href: d.category === "localization" ? "/admin/control-center/localization" : d.category === "branding" || d.category === "contact" ? "/admin/control-center/branding" : "/admin/control-center/platform" });
  if (wanted("feature") && can("platform:features:view")) {
    for (const f of await listFlagViews()) if (match(f.key, f.description, f.state)) hits.push({ type: "feature", key: f.key, label: f.key, category: f.sensitive ? "sensitive" : "standard", status: f.state, href: "/admin/control-center/features" });
    for (const s of SPEC_FLAGS) if (!s.enforced && match(s.specKey, s.note)) hits.push({ type: "feature", key: s.specKey, label: s.specKey, category: "not enforced", status: "NOT_ENFORCED", href: "/admin/control-center/features" });
  }
  if (wanted("provider") && can("platform:providers:view")) for (const p of await listProviderViews()) if (match(p.key, p.label, p.categoryLabel, p.status, p.environment)) hits.push({ type: "provider", key: p.key, label: p.label, category: p.category, status: p.status, href: "/admin/control-center/providers" });

  return hits
    .filter((h) => !params.status || (h.status ?? "").toLowerCase() === params.status.toLowerCase())
    .filter((h) => !params.category || h.category.toLowerCase() === params.category.toLowerCase())
    .slice(0, 100);
}

export async function exportConfiguration(admin: SessionAdmin) {
  if (!admin.permissions.includes("platform:configuration:manage")) throw new ApiError(403, "Forbidden: insufficient permissions");
  const [settings, flags, providers, maintenance] = await Promise.all([getPlatformSettings(), listFlagViews(), listProviderViews(), getMaintenanceView()]);
  const out = {
    format: "lpp-configuration-export/1",
    generatedAt: new Date().toISOString(),
    environment: currentEnvironment(),
    note: "Safe metadata only. No credentials, tokens, keys or secret names are included, and this file cannot be imported.",
    settings: settings.map((s) => ({ key: s.def.key, type: s.def.type, value: safeConfigValue(s.def.key, s.value), version: s.version, isDefault: s.isDefault })),
    featureFlags: flags.map((f) => ({ key: f.key, state: f.state, rolloutPercent: f.rolloutPercent, targets: f.targets, version: f.version })),
    providers: providers.map((p) => ({ key: p.key, category: p.category, status: p.status, environment: p.environment })),
    maintenance: { kind: maintenance.kind, active: maintenance.active },
  };
  await writeAudit({ action: "PLATFORM_CONFIG_EXPORTED", adminId: admin.id, meta: { settings: out.settings.length, flags: out.featureFlags.length, providers: out.providers.length } });
  return out;
}

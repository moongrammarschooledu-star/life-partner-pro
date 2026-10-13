import { NextResponse } from "next/server";
import { requireAdmin, handleApiError } from "@/lib/route-guard";
import { currentEnvironment } from "@/lib/platform/environment";
import { getPlatformSettings } from "@/lib/platform/settings";
import { permissionForSetting } from "@/lib/platform/settings-registry";
import { safeConfigValue } from "@/lib/platform/config-values";

export const dynamic = "force-dynamic";

// Settings the caller may see: identity, localization and status need platform:settings:view; branding and public contact need platform:branding:view.
export async function GET() {
  try {
    const admin = await requireAdmin();
    const canSettings = admin.permissions.includes("platform:settings:view");
    const canBranding = admin.permissions.includes("platform:branding:view");
    if (!canSettings && !canBranding) return NextResponse.json({ error: "Forbidden: insufficient permissions" }, { status: 403 });
    const all = await getPlatformSettings();
    const items = all
      .filter((s) => (permissionForSetting(s.def) === "platform:branding:manage" ? canBranding : canSettings))
      .map((s) => ({ key: s.def.key, label: s.def.label, description: s.def.description, category: s.def.category, type: s.def.type, enumValues: s.def.enumValues ?? null, maxLength: s.def.maxLength ?? null, allowEmpty: s.def.allowEmpty ?? false, risk: s.def.risk, appliedBy: s.def.appliedBy, value: safeConfigValue(s.def.key, s.value), version: s.version, isDefault: s.isDefault, updatedAt: s.updatedAt }));
    return NextResponse.json({ environment: currentEnvironment(), items, canManage: { settings: admin.permissions.includes("platform:settings:manage"), branding: admin.permissions.includes("platform:branding:manage") } });
  } catch (error) {
    return handleApiError(error);
  }
}
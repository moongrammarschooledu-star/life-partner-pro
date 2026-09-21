import { prisma } from "@/lib/prisma";
import { weightsFromSettings, hardRequirementsFromSettings, enabledCategoriesFromSettings, DEFAULT_WEIGHTS } from "@/lib/matching";
import { DEFAULT_MATCH_CONFIG, type MatchConfigLite } from "@/lib/ai/analysis/mutual";

// Reads the SAME admin-configured weights / hard requirements / enabled
// categories the deterministic matching routes use (AppSettings), so an AI
// explanation always describes the score the matcher itself would produce.
export async function loadMatchConfig(): Promise<MatchConfigLite> {
  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings) return { ...DEFAULT_MATCH_CONFIG, weights: DEFAULT_WEIGHTS };
  return {
    weights: weightsFromSettings(settings),
    hardRequirements: hardRequirementsFromSettings(settings),
    enabled: enabledCategoriesFromSettings(settings),
  };
}

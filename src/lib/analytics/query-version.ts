// the numeric part of a compute version label ("v1" -> 1): stored with every mart row so history stays reproducible
export function versionNumber(def: { computeVersion: string }): number {
  return Number(def.computeVersion.replace(/\D/g, "")) || 1;
}

import type { CaseType } from "@prisma/client";
import type { Permission } from "@/lib/permissions";

// Spec §34 lists support:*/complaints:*/safety_cases:* as their own
// permission families alongside the generic cases:* lifecycle permissions.
// This gives them real, distinct meaning: an additional type-specific gate
// checked alongside the generic action permission (e.g. resolving a
// COMPLAINT needs cases:resolve AND complaints:resolve), rather than three
// duplicated implementations of the same lifecycle logic. Returns null when
// no type-specific permission exists for that action (e.g. "assign"/"merge"
// are generic-only).
export function typePermissionFor(type: CaseType, action: "view" | "create" | "review" | "resolve" | "close"): Permission | null {
  if (type === "SUPPORT") {
    if (action === "view") return "support:view";
    if (action === "create") return "support:create";
    if (action === "resolve") return "support:resolve";
    if (action === "close") return "support:close";
    return null;
  }
  if (type === "COMPLAINT") {
    if (action === "view") return "complaints:view";
    if (action === "create") return "complaints:create";
    if (action === "review") return "complaints:review";
    if (action === "resolve") return "complaints:resolve";
    return null;
  }
  if (type === "SAFETY_REPORT") {
    if (action === "view") return "safety_cases:view";
    if (action === "review") return "safety_cases:review";
    if (action === "resolve") return "safety_cases:resolve";
    return null;
  }
  return null; // INTERNAL — generic cases:* permissions only
}

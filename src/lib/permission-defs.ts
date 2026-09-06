import { prisma } from "@/lib/prisma";
import type { Permission } from "@/lib/permissions";

// Metadata-only registry backing the Permission Matrix UI's checkbox grid
// (src/app/admin/(shell)/permission-matrix/page.tsx) — NOT the authorization
// source of truth (that's ROLE_PERMISSIONS in src/lib/permissions.ts). Every
// permission string that exists gets a row here so it can be assigned to a
// custom role; descriptions are short, human-readable labels for the grid.
const DESCRIPTIONS: Partial<Record<Permission, string>> = {
  "profile:view": "View profile details",
  "profile:edit": "Edit profile information",
  "profile:delete": "Archive / soft-delete a profile",
  "profile:verify": "Mark a profile as verified",
  "profile:status": "Change a profile's status",
  "profile:assign": "Assign a profile to a staff member",
  "contact:reveal": "Reveal hidden contact information",
  "match:run": "Run and review the matching engine",
  "proposal:create": "Create a rishta proposal",
  "proposal:edit": "Edit an existing proposal",
  "proposal:assign": "Assign a proposal to a staff member",
  "note:add": "Add a private admin note",
  "communication:add": "Log a manual communication",
  "communication:view": "View communication history",
  "communication:send": "Send a communication",
  "communication:message:view": "View full message bodies",
  "audit:view": "View the audit log",
  "settings:edit": "Change platform settings",
  "admin:manage": "Manage admin accounts and roles",
  "verification:view": "View verification status",
  "verification:review": "Review a verification case",
  "verification:document:view": "View uploaded verification documents",
  "verification:flag:manage": "Manage security/trust flags",
  "verification:duplicate:scan": "Run duplicate-profile scans",
  "verification:assign": "Assign a verification case to staff",
  "notification:template:manage": "Edit notification templates",
  "reports:view": "View reports and analytics",
  "reports:export": "Export a report",
  "reports:income:view": "View income analytics",
  "reports:staff-performance:view": "View staff performance analytics",
  "reports:schedule:manage": "Schedule automated reports",
  "sensitive:income:view": "View individual income figures",
  "sensitive:notes:view": "View other admins' private notes",
  "sensitive:family:view": "View family background details",
  "staff:view": "View the team workload dashboard",
};

function moduleAndAction(key: Permission): { module: string; action: string } {
  const parts = key.split(":");
  return { module: parts[0], action: parts.slice(1).join(":") };
}

export async function ensurePermissionDefsSeeded(): Promise<void> {
  const keys = Object.keys(DESCRIPTIONS) as Permission[];
  await prisma.$transaction(
    keys.map((key) => {
      const { module, action } = moduleAndAction(key);
      return prisma.permissionDef.upsert({
        where: { key },
        update: { module, action, description: DESCRIPTIONS[key] ?? null },
        create: { key, module, action, description: DESCRIPTIONS[key] ?? null },
      });
    })
  );
}

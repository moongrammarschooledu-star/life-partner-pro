import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { SWITCH_FIELD } from "@/lib/ops/system-control";
import { parseControlUpdate } from "@/lib/ops/control-schema";

// STEP 34 §51 — an emergency switch that stops NEW contact shares without deleting anything.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("contact sharing emergency switch", () => {
  it("is a registered switch backed by a column that defaults to off", () => {
    expect(SWITCH_FIELD.contactSharing).toBe("emergencyContactSharingDisabled");
    expect(read("prisma/schema.prisma")).toMatch(/emergencyContactSharingDisabled\s+Boolean\s+@default\(false\)/);
    expect(read("prisma/migrations/20261012100000_step34_contact_sharing_switch/migration.sql")).toMatch(/DEFAULT false/);
  });

  it("can be set through the validated emergency section (and only with a boolean)", () => {
    expect(parseControlUpdate("emergency", { emergencyContactSharingDisabled: true })).toMatchObject({ ok: true });
    expect(parseControlUpdate("emergency", { emergencyContactSharingDisabled: "yes" })).toMatchObject({ ok: false });
  });

  it("the share route checks it before it reads or writes anything about the two profiles", () => {
    const src = read("src/app/api/admin/profiles/[id]/contact/route.ts");
    const post = src.slice(src.indexOf("export async function POST"));
    expect(post.indexOf('assertSwitchOpen("contactSharing")')).toBeGreaterThan(-1);
    expect(post.indexOf('assertSwitchOpen("contactSharing")')).toBeLessThan(post.indexOf("hasActiveRestriction"));
    expect(post.indexOf('assertSwitchOpen("contactSharing")')).toBeLessThan(post.indexOf("contactShareLog.create"));
  });

  it("is listed in the administrator panel", () => {
    expect(read("src/components/admin/system/config-panels.tsx")).toContain("emergencyContactSharingDisabled");
  });

  it("the only code that creates a contact share is that route (so one switch is enough)", () => {
    const hits = ["src/lib", "src/app"].flatMap((root) => {
      const out: string[] = [];
      const walk = (d: string) => {
        for (const e of readdirSync(d)) {
          const f = join(d, e);
          if (statSync(f).isDirectory()) walk(f);
          else if (/\.tsx?$/.test(e) && !/\.test\./.test(e) && /contactShareLog\.create\(/.test(readFileSync(f, "utf8"))) out.push(f.replace(process.cwd(), ""));
        }
      };
      walk(join(process.cwd(), root));
      return out;
    });
    expect(hits.length).toBe(1);
    expect(hits[0].split("\\").join("/")).toContain("profiles/[id]/contact/route.ts");
  }, 60_000);
});

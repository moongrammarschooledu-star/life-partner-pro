import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

// STEP 34 §36 - the file runbooks exist and each has every part the spec asks for, so none can be gutted unnoticed.
const NAMES = ["deployment", "rollback", "database-recovery", "backup-restore", "security-incident", "provider-outage", "payment-outage", "whatsapp-outage", "email-outage", "database-failure", "storage-failure", "dns-recovery"];
const PARTS = ["Symptoms", "Diagnosis", "Verification", "Escalation", "Rollback", "Post-incident"];

describe("docs/runbooks", () => {
  it.each(NAMES)("%s.md exists with every required part", (name) => {
    const file = join(process.cwd(), "docs", "runbooks", `${name}.md`);
    expect(existsSync(file)).toBe(true);
    const text = readFileSync(file, "utf8");
    for (const part of PARTS) expect(text, `${name} lacks ${part}`).toMatch(new RegExp(`^## ${part}`, "m"));
    expect(text, `${name} lacks actions`).toMatch(/^## (Immediate actions|Recovery|Steps)/m);
    expect(text, `${name} lacks recovery`).toMatch(/Recovery/);
  });

  it("the index links every runbook", () => {
    const index = readFileSync(join(process.cwd(), "docs", "runbooks", "README.md"), "utf8");
    for (const name of NAMES) expect(index).toContain(`${name}.md`);
  });

  it("no runbook contains something that looks like a secret", () => {
    for (const name of NAMES) {
      const text = readFileSync(join(process.cwd(), "docs", "runbooks", `${name}.md`), "utf8");
      expect(text).not.toMatch(/sk_(live|test)_[A-Za-z0-9]{8,}|postgres(ql)?:\/\/[^\s<]+:[^\s<@]+@/);
    }
  });
});

describe("deployment scripts", () => {
  it("deploy-db.sh refuses to run without proof of a backup and never uses data-loss flags", () => {
    const sh = readFileSync(join(process.cwd(), "scripts", "deploy-db.sh"), "utf8");
    expect(sh).toContain("--backup-ref");
    expect(sh).not.toMatch(/--accept-data-loss|db push|migrate reset/);
  });
});

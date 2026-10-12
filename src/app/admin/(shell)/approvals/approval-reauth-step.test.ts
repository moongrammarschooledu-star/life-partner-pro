import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// A policy flagged reauthRequired makes the approve route answer 403 "re-enter your password". The detail page used to show that message with no place to
// type the password, so no administrator could approve such a request (found while approving a payment rollout). The page must now hold the call, ask
// for the password in a dialog and re-send the same call with the confirmed token.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("approval detail page: password step", () => {
  const page = read("src/app/admin/(shell)/approvals/[id]/page.tsx");
  const route = read("src/app/api/admin/approvals/[id]/approve/route.ts");

  it("the approve route still asks for a fresh password for sensitive policies, with a message the page recognises", () => {
    expect(route).toContain("requireReauth(admin, body.reauthToken");
    expect(read("src/lib/ops/admin-route.ts")).toMatch(/re-enter your password/);
  });

  it("the page recognises that answer instead of only showing it as an error", () => {
    expect(page).toMatch(/res\.status === 403/);
    expect(page).toMatch(/re-enter your password/);
    expect(page).toContain("setReauthFor(");
  });

  it("the page asks for the password through the shared dialog and re-sends the call with the confirmed token", () => {
    expect(page).toContain("SensitiveActionDialog");
    expect(page).toMatch(/reauthToken: stepUpToken/);
    expect(page).toMatch(/\/api\/admin\/approvals\/\$\{id\}\$\{reauthFor\.path\}/);
  });

  it("the password dialog posts it only to the existing re-authentication route (never stores or logs it)", () => {
    const shared = read("src/components/admin/system/shared.tsx");
    expect(shared).toContain("/api/admin/auth/reauth");
    expect(page).not.toMatch(/localStorage|sessionStorage|console\.(log|error)\([^)]*password/i);
  });
});

// The Execute button on this page only RECORDS an execution; it does not perform the action. A payment rollout was marked executed this way with the stage
// unchanged, which used up the approval. The button must now explain that and ask first.
describe("approval detail page: Execute button", () => {
  const page = readFileSync(join(process.cwd(), "src/app/admin/(shell)/approvals/[id]/page.tsx"), "utf8");

  it("does not call the execute route straight from the click", () => {
    const button = page.slice(page.indexOf("canExecute && ("), page.indexOf("canDelegate && ("));
    expect(button).toContain("setExecuteOpen(true)");
    expect(button).not.toContain("callAction(\"/execute\"");
  });

  it("asks first and says plainly that nothing is carried out", () => {
    expect(page).toContain("Mark this request as executed?");
    expect(page).toMatch(/does NOT carry out the action/);
    expect(page).toContain('callAction("/execute", {}, "Marked as executed")');
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Found by the sandbox payment test: the Refunds tab could approve and execute a refund, but nothing in the admin console could START one (only the
// API had a POST), so the sandbox checklist item "Completed refund" could not be reached and an operator had no way to begin a refund.
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("Finance Center: requesting a refund", () => {
  const page = read("src/app/admin/(shell)/finance-center/page.tsx");
  const section = page.slice(page.indexOf("function PaymentsSection()"), page.indexOf("function OrdersSection()"));

  it("offers 'Request refund' only on a payment that is PAID or PARTIALLY_REFUNDED", () => {
    expect(section).toMatch(/p\.status === "PAID" \|\| p\.status === "PARTIALLY_REFUNDED"/);
    expect(section).toContain("Request refund");
  });

  it("posts to the refunds route with the payment, a validated amount, the type and a reason", () => {
    expect(section).toContain('"/api/admin/finance-center/refunds"');
    expect(section).toContain("paymentId: refunding.id");
    expect(section).toContain("amountMinor > refunding.amountMinor");
    expect(section).toContain("type: refundType");
    expect(section).toContain("reason: refundReason.trim()");
  });

  it("shows the server's answer instead of swallowing a failure", () => {
    expect(section).toContain('show(typeof json.error === "string" ? json.error : "Could not request the refund.", "error")');
  });

  it("only creates the request: approval by another admin and a password at execution are untouched", () => {
    expect(section).toContain("A different finance admin must approve it");
    const route = read("src/app/api/admin/finance-center/refunds/route.ts");
    expect(route).toContain('requireAdmin("finance:refunds:request")');
    expect(read("src/lib/finance/refund.ts")).toContain("You cannot approve a refund you requested yourself");
    expect(read("src/app/api/admin/finance-center/refunds/[id]/execute/route.ts")).toContain("Password re-confirmation is required to execute a refund.");
  });
});

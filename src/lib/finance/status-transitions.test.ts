import { describe, it, expect } from "vitest";
import { isValidPaymentStatusTransition, isValidOrderStatusTransition, isValidRefundStatusTransition, isValidSubscriptionStatusTransition, isValidRolloutTransition } from "./status-transitions";

describe("isValidPaymentStatusTransition", () => {
  it("allows the normal happy path", () => {
    expect(isValidPaymentStatusTransition("CREATED", "PENDING")).toBe(true);
    expect(isValidPaymentStatusTransition("PENDING", "PROCESSING")).toBe(true);
    expect(isValidPaymentStatusTransition("PROCESSING", "PAID")).toBe(true);
  });
  it("allows a paid payment to be refunded", () => {
    expect(isValidPaymentStatusTransition("PAID", "REFUNDED")).toBe(true);
    expect(isValidPaymentStatusTransition("PAID", "PARTIALLY_REFUNDED")).toBe(true);
  });
  it("rejects skipping straight from CREATED to PAID", () => {
    expect(isValidPaymentStatusTransition("CREATED", "PAID")).toBe(false);
  });
  it("rejects any transition out of a terminal state", () => {
    expect(isValidPaymentStatusTransition("REFUNDED", "PAID")).toBe(false);
    expect(isValidPaymentStatusTransition("CANCELLED", "PENDING")).toBe(false);
  });
  it("allows a failed payment to be retried", () => {
    expect(isValidPaymentStatusTransition("FAILED", "PENDING")).toBe(true);
  });
});

describe("isValidOrderStatusTransition", () => {
  it("allows the normal happy path", () => {
    expect(isValidOrderStatusTransition("DRAFT", "PENDING_PAYMENT")).toBe(true);
    expect(isValidOrderStatusTransition("PENDING_PAYMENT", "PAYMENT_PROCESSING")).toBe(true);
    expect(isValidOrderStatusTransition("PAYMENT_PROCESSING", "PAID")).toBe(true);
  });
  it("rejects skipping straight from DRAFT to PAID", () => {
    expect(isValidOrderStatusTransition("DRAFT", "PAID")).toBe(false);
  });
  it("rejects any transition out of CANCELLED", () => {
    expect(isValidOrderStatusTransition("CANCELLED", "PAID")).toBe(false);
  });
});

describe("isValidRefundStatusTransition", () => {
  it("allows the normal approval path", () => {
    expect(isValidRefundStatusTransition("REQUESTED", "PENDING_APPROVAL")).toBe(true);
    expect(isValidRefundStatusTransition("PENDING_APPROVAL", "APPROVED")).toBe(true);
    expect(isValidRefundStatusTransition("APPROVED", "PROCESSING")).toBe(true);
    expect(isValidRefundStatusTransition("PROCESSING", "COMPLETED")).toBe(true);
  });
  it("rejects re-processing an already-completed refund (idempotency guard)", () => {
    expect(isValidRefundStatusTransition("COMPLETED", "PROCESSING")).toBe(false);
    expect(isValidRefundStatusTransition("COMPLETED", "COMPLETED")).toBe(false);
  });
  it("rejects skipping approval entirely", () => {
    expect(isValidRefundStatusTransition("REQUESTED", "PROCESSING")).toBe(false);
  });
  it("allows rejection from either requested or pending-approval", () => {
    expect(isValidRefundStatusTransition("REQUESTED", "REJECTED")).toBe(true);
    expect(isValidRefundStatusTransition("PENDING_APPROVAL", "REJECTED")).toBe(true);
  });
});

describe("isValidSubscriptionStatusTransition", () => {
  it("allows the grace-period path (spec §25)", () => {
    expect(isValidSubscriptionStatusTransition("ACTIVE", "PAST_DUE")).toBe(true);
    expect(isValidSubscriptionStatusTransition("PAST_DUE", "GRACE_PERIOD")).toBe(true);
    expect(isValidSubscriptionStatusTransition("GRACE_PERIOD", "EXPIRED")).toBe(true);
  });
  it("allows recovering from past-due or grace period back to active", () => {
    expect(isValidSubscriptionStatusTransition("PAST_DUE", "ACTIVE")).toBe(true);
    expect(isValidSubscriptionStatusTransition("GRACE_PERIOD", "ACTIVE")).toBe(true);
  });
  it("rejects any transition out of CANCELLED", () => {
    expect(isValidSubscriptionStatusTransition("CANCELLED", "ACTIVE")).toBe(false);
  });
  it("allows reactivation from EXPIRED via a new successful payment", () => {
    expect(isValidSubscriptionStatusTransition("EXPIRED", "ACTIVE")).toBe(true);
  });
});

describe("isValidRolloutTransition", () => {
  it("allows forward progression one stage at a time", () => {
    expect(isValidRolloutTransition("DISABLED", "SANDBOX")).toBe(true);
    expect(isValidRolloutTransition("SANDBOX", "INTERNAL")).toBe(true);
    expect(isValidRolloutTransition("INTERNAL", "BETA")).toBe(true);
    expect(isValidRolloutTransition("BETA", "PRODUCTION")).toBe(true);
  });
  it("rejects skipping a stage", () => {
    expect(isValidRolloutTransition("DISABLED", "INTERNAL")).toBe(false);
    expect(isValidRolloutTransition("DISABLED", "BETA")).toBe(false);
    expect(isValidRolloutTransition("DISABLED", "PRODUCTION")).toBe(false);
    expect(isValidRolloutTransition("SANDBOX", "BETA")).toBe(false);
    expect(isValidRolloutTransition("SANDBOX", "PRODUCTION")).toBe(false);
    expect(isValidRolloutTransition("INTERNAL", "PRODUCTION")).toBe(false);
  });
  it("allows the kill switch from every active stage", () => {
    expect(isValidRolloutTransition("SANDBOX", "DISABLED")).toBe(true);
    expect(isValidRolloutTransition("INTERNAL", "DISABLED")).toBe(true);
    expect(isValidRolloutTransition("BETA", "DISABLED")).toBe(true);
    expect(isValidRolloutTransition("PRODUCTION", "DISABLED")).toBe(true);
  });
  it("rejects any lateral or backward move that bypasses DISABLED", () => {
    expect(isValidRolloutTransition("PRODUCTION", "BETA")).toBe(false);
    expect(isValidRolloutTransition("BETA", "INTERNAL")).toBe(false);
    expect(isValidRolloutTransition("INTERNAL", "SANDBOX")).toBe(false);
    expect(isValidRolloutTransition("PRODUCTION", "SANDBOX")).toBe(false);
  });
  it("rejects a no-op transition to the same stage", () => {
    expect(isValidRolloutTransition("PRODUCTION", "PRODUCTION")).toBe(false);
    expect(isValidRolloutTransition("DISABLED", "DISABLED")).toBe(false);
  });
});

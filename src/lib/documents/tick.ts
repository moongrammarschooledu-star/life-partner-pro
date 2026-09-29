import { sweepDocumentExpiration, type ExpirationSweepResult } from "@/lib/documents/expiration";
import { sweepOverdueRequests } from "@/lib/documents/request-service";
import { sweepExpiredShares } from "@/lib/documents/sharing-service";
import { sweepExpiredSignatureRequests } from "@/lib/documents/signature-service";
import { seedDocumentCatalog } from "@/lib/documents/catalog";

// The document part of the single daily tick (Vercel Hobby allows one cron) — mirrors
// src/lib/communications/tick.ts's shape exactly. Retention runs separately inside
// runDueRetentionActions (src/lib/privacy/retention-policy.ts), like every other category.

export interface DocumentTickResult {
  expiration: ExpirationSweepResult | null;
  requests: { reminded: number; expired: number } | null;
  sharesExpired: number | null;
  signatureRequestsExpired: number | null;
  errors: string[];
}

async function step<T>(name: string, errors: string[], fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    errors.push(`${name}: ${error instanceof Error ? error.message.slice(0, 160) : "failed"}`);
    return null;
  }
}

export async function runDocumentTick(): Promise<DocumentTickResult> {
  const errors: string[] = [];
  await step("seed-catalog", errors, seedDocumentCatalog); // idempotent — cheap insurance if a fresh env never ran it
  const expiration = await step("expiration", errors, () => sweepDocumentExpiration());
  const requests = await step("requests", errors, () => sweepOverdueRequests());
  const sharesExpired = await step("shares", errors, () => sweepExpiredShares());
  const signatureRequestsExpired = await step("signatures", errors, () => sweepExpiredSignatureRequests());
  return { expiration, requests, sharesExpired, signatureRequestsExpired, errors };
}

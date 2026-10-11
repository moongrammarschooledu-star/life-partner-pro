import { createHmac } from "crypto";

// Salted HMAC used to keep account and network identifiers out of the security event ledger. Not reversible without the server secret, and
// stable, so counting per account or per network still works. Lives in its own tiny module (no database, no rule engine) so lightweight
// callers can use it without pulling the whole security event pipeline into their bundle.

function hashSecret(): string {
  return process.env.RISK_HASH_SALT ?? process.env.NEXTAUTH_SECRET ?? "lpp-dev-risk-salt";
}

export function hashIdentifier(value: string): string {
  return createHmac("sha256", hashSecret()).update(value.trim().toLowerCase()).digest("hex").slice(0, 32);
}

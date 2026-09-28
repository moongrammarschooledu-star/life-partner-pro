import { createHmac } from "crypto";

// Suppressions for an EXTERNAL address (a bounced e-mail, an SMS STOP) are keyed by a salted hash of the normalized address, never
// by the address itself, so the suppression list is not a second copy of anyone's contact details.
function salt(): string {
  return process.env.COMMUNICATION_HASH_SALT ?? process.env.RISK_HASH_SALT ?? process.env.NEXTAUTH_SECRET ?? "lpp-dev-communication-salt";
}

export function normalizeDestination(destination: string): string {
  const v = destination.trim().toLowerCase();
  return v.includes("@") ? v : v.replace(/[^\d+]/g, "");
}

export function hashDestination(destination: string): string {
  return createHmac("sha256", salt()).update(normalizeDestination(destination)).digest("hex").slice(0, 40);
}

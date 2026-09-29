import { randomUUID } from "crypto";
import type { DocumentSignatureProvider, SignatureProviderResult } from "@/lib/documents/providers/types";

// The default signature provider: an authenticated IN-APP acknowledgement. It is NOT a cryptographic or
// legally-binding e-signature — the recipient's own session, an explicit consent checkbox, and their
// typed full legal name are recorded, alongside the document's hash and a timestamp, as evidence of
// acknowledgement. This is the honest default when no real, jurisdiction-reviewed e-signature vendor is
// configured (spec §40's own instruction: "do not claim legally binding unless configured/legal-reviewed").
// A real provider (DocuSign-shaped) can replace this behind the same DocumentSignatureProvider interface.
export class LocalSignatureProvider implements DocumentSignatureProvider {
  readonly key = "LOCAL";
  readonly legallyBinding = false;

  // No fields of the request are actually needed to create a LOCAL reference — the real content lives in
  // DocumentSignatureRequest/Recipient rows, created by the caller (signature-service.ts).
  async createSignatureRequest(): Promise<SignatureProviderResult> {
    return { ok: true, providerReference: `local-${randomUUID()}` };
  }

  async sendSignatureRequest(providerReference: string): Promise<SignatureProviderResult> {
    // Nothing to "send" externally — the recipient sees it in their own notification center /
    // signature inbox once the signature-service marks the request SENT.
    return { ok: true, providerReference };
  }

  async getSignatureStatus(): Promise<{ status: string } | null> {
    return null; // status lives entirely in DocumentSignatureRequest/Recipient — never asked of this provider
  }

  async verifySignature(): Promise<boolean> {
    return true; // an in-app acknowledgement has no external signature artifact to cryptographically verify
  }

  async voidSignatureRequest(providerReference: string): Promise<SignatureProviderResult> {
    return { ok: true, providerReference };
  }
}

export const localSignatureProvider = new LocalSignatureProvider();

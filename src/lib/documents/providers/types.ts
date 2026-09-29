// Provider-neutral e-signature layer (spec §40). Application code depends only on this interface —
// a real vendor (DocuSign-shaped) can be plugged in later without touching the signature service.

export interface SignerInput {
  recipientType: string;
  recipientId: string;
  name?: string; // display name only, never used as proof of identity
}

export interface SignatureProviderResult {
  ok: boolean;
  providerReference?: string;
  error?: string;
}

export interface DocumentSignatureProvider {
  readonly key: string;
  // Whether this provider is a real cryptographic/legally-binding e-signature service. LocalSignatureProvider
  // is false — see its own file for why — a real vendor implementation would set this true only after
  // jurisdiction/legal review, per the spec's explicit instruction never to claim this without one.
  readonly legallyBinding: boolean;

  createSignatureRequest(params: { documentId: string; signers: SignerInput[] }): Promise<SignatureProviderResult>;
  sendSignatureRequest(providerReference: string): Promise<SignatureProviderResult>;
  getSignatureStatus(providerReference: string): Promise<{ status: string } | null>;
  verifySignature(providerReference: string): Promise<boolean>;
  voidSignatureRequest(providerReference: string, reason: string): Promise<SignatureProviderResult>;
}
